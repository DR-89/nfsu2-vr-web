//! Kind 34 is the bounded VR extension, consumed here rather than routed as a
//! game datagram. Identity comes from the admitted connection, never its body.
use crate::{LanSwitch, Out, Peer};
use bytes::Bytes;
use nfsu2_util::host::AvatarLinks;
use nfsu2_util::mono_ms;
use std::{sync::Arc, time::Duration};

impl LanSwitch {
    pub(crate) fn vr_message(&self, peer: &Peer, data: &[u8]) {
        if !peer.hello.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }
        if data.len() < 5 || data.len() > nfsu2_vr::MAX_BYTES + 4 || data[1..4] != [0, 0, 0] {
            self.stats.limited.inc();
            return;
        }
        // Shares the control budget with chat/room changes; the client sends at
        // 10 Hz so other controls retain half the default 20 Hz allowance.
        if !peer.ctl.lock().texts.take_at(mono_ms(), 1.0) {
            self.stats.limited.inc();
            return;
        }
        // Admission and disconnect use this same lock. An old connection cannot
        // recreate room state after its address has been handed to a new one.
        let members = self.members.lock();
        if !members.peers.get(&peer.vip).is_some_and(|p| std::ptr::eq(p.as_ref(), peer)) {
            return;
        }
        let out = self.vr.lock().receive(peer.vip, &data[4..], mono_ms().max(0.0) as u64);
        self.vr_deliver(out);
        drop(members);
    }
    pub(crate) fn vr_gone(&self, vip: u32) {
        let out = self.vr.lock().leave(vip, mono_ms().max(0.0) as u64);
        self.vr_deliver(out);
    }
    fn vr_deliver(&self, out: Vec<nfsu2_vr::Delivery>) {
        for (vip, event) in out {
            let Ok(json) = serde_json::to_vec(&event) else { continue };
            let mut data = Vec::with_capacity(4 + json.len());
            data.extend_from_slice(&[34, 0, 0, 0]);
            data.extend_from_slice(&json);
            // The regular socket queue remains bounded and applies backpressure.
            let guard = crate::slot(vip).map(|i| self.table[i].load());
            if let Some(p) = guard.as_ref().and_then(|g| g.as_ref()).filter(|p| p.open()) {
                self.send(p, Out::Raw(Bytes::from(data)));
            }
        }
    }
    async fn vr_routes(&self) {
        let queried_at = mono_ms().max(0.0) as u64;
        let expected = self.vr.lock().members();
        if expected.is_empty() {
            return;
        }
        let peers = {
            let members = self.members.lock();
            expected.iter().filter_map(|(v, g)| members.peers.get(v).map(|p| (*v, *g, p.clone()))).collect::<Vec<_>>()
        };
        let ids: Vec<_> = peers.iter().map(|(v, _, _)| *v).collect();
        let query = async {
            let online = async {
                match &self.online {
                    Some(h) => h.avatar_links(ids.clone()).await.ok(),
                    None => Some(AvatarLinks::default()),
                }
            };
            let roam = async {
                match &self.roam {
                    Some(h) => h.avatar_links(ids.clone()).await.ok(),
                    None => Some(AvatarLinks::default()),
                }
            };
            tokio::join!(online, roam)
        };
        // Keep one query outstanding per host, even when its thread stalls.
        // Membership and routes still expire while waiting; old answers cannot
        // refresh permissions. No task or repeated query is spawned per frame.
        tokio::pin!(query);
        let mut expiry = tokio::time::interval(Duration::from_millis(250));
        expiry.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let answer = loop {
            tokio::select! {
                _=self.stopped.cancelled()=>return,
                answer=&mut query=>break answer,
                _=expiry.tick()=>{
                    let out=self.vr.lock().tick(mono_ms().max(0.0) as u64);self.vr_deliver(out);
                }
            }
        };
        let (Some(online), Some(roam)) = answer else {
            return;
        };
        if mono_ms().max(0.0) as u64 >= queried_at.saturating_add(1000) {
            return;
        }
        let members = self.members.lock();
        let live: Vec<_> = peers
            .iter()
            .filter(|(v, _, p)| members.peers.get(v).is_some_and(|current| Arc::ptr_eq(current, p)))
            .map(|(v, g, _)| (*v, *g))
            .collect();
        let managed = |v: &u32| online.managed.contains(v) || roam.managed.contains(v);
        let mut server: Vec<_> = online.pairs.iter().map(|&(a, b)| (a, b, 0)).collect();
        server.extend(roam.cars.iter().copied().filter(|(a, b, _)| !online.managed.contains(a) && !online.managed.contains(b)));
        let mut hub = self.vr.lock();
        let lan = hub
            .mutual_pairs()
            .into_iter()
            .filter(|(a, b)| !managed(a) && !managed(b) && [a, b].iter().all(|v| members.peers.get(*v).is_some_and(|p| p.lan())))
            .collect();
        let out = hub.set_routes(&live, server, lan, queried_at);
        drop(hub);
        self.vr_deliver(out);
    }
    pub(crate) fn start_vr_timer(self: &Arc<Self>) {
        let me = Arc::downgrade(self);
        let stopped = self.stopped.clone();
        tokio::spawn(async move {
            let mut clock = tokio::time::interval(Duration::from_millis(250));
            clock.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    _ = stopped.cancelled() => return,
                    _ = clock.tick() => {
                        let Some(sw) = me.upgrade() else { return };
                        let out = sw.vr.lock().tick(mono_ms().max(0.0) as u64);
                        sw.vr_deliver(out);
                        sw.vr_routes().await;
                    }
                }
            }
        });
    }
}
