mod harness;
use bytes::Bytes;
use harness::*;
use nfsu2_util::{FrameCtx, Host, host::AvatarLinks};
use serde_json::{Value, json};
use std::collections::HashSet;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tokio::sync::oneshot;

#[derive(Default)]
struct Gate {
    state: Mutex<AvatarLinks>,
    resumed: Mutex<Vec<u32>>,
    hold: AtomicBool,
    pending: Mutex<Vec<oneshot::Sender<AvatarLinks>>>,
}
impl Host for Gate {
    fn vip(&self) -> u32 {
        0x0a4d0001
    }
    fn name(&self) -> &str {
        "online"
    }
    fn listed(&self) -> bool {
        true
    }
    fn frame(&self, _from: u32, _data: Bytes, _ctx: FrameCtx) {}
    fn peer_gone(&self, _vip: u32) {}
    fn peer_resumed(&self, vip: u32) {
        self.resumed.lock().unwrap().push(vip);
    }
    fn stop(&self) {}
    fn info(&self) -> oneshot::Receiver<Value> {
        let (tx, rx) = oneshot::channel();
        let _ = tx.send(json!({}));
        rx
    }
    fn vips(&self) -> oneshot::Receiver<HashSet<u32>> {
        let (tx, rx) = oneshot::channel();
        let _ = tx.send(HashSet::new());
        rx
    }
    fn avatar_links(&self, _vips: Vec<u32>) -> oneshot::Receiver<AvatarLinks> {
        let (tx, rx) = oneshot::channel();
        if self.hold.load(Ordering::Relaxed) {
            self.pending.lock().unwrap().push(tx);
        } else {
            let _ = tx.send(self.state.lock().unwrap().clone());
        }
        rx
    }
}

fn frame(v: Value) -> Vec<u8> {
    let mut b = vec![34, 0, 0, 0];
    b.extend(serde_json::to_vec(&v).unwrap());
    b
}
fn events(c: &Client) -> Vec<Value> {
    c.got().frames.iter().filter_map(|(b, _)| if b.first() == Some(&34) { serde_json::from_slice(&b[4..]).ok() } else { None }).collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn only_a_private_resume_token_restores_host_membership() {
    let _serial = serial().await;
    let gate = Arc::new(Gate::default());
    let sw = start_full(opts(), "", Some(gate.clone()), None, None).await;
    let mut a = Client::connect(sw.port, "Alpha").await;
    a.welcome().await;
    let bad = "C".repeat(22);
    let mut x = Client::new(sw.port, "Alpha", "", Some((a.vip, &bad)), Opts::default()).await;
    x.welcome().await;
    assert_ne!(x.vip, a.vip);
    assert!(gate.resumed.lock().unwrap().is_empty(), "a name or address claim cannot restore a race");
    let mut again = Client::new(sw.port, "Alpha", "", Some((a.vip, &a.token)), Opts::default()).await;
    again.welcome().await;
    assert_eq!(again.vip, a.vip);
    a.closed().await;
    assert_eq!(*gate.resumed.lock().unwrap(), vec![a.vip]);
    again.terminate();
    wait_for(3000, || !sw.has(a.vip)).await;
    let mut after_loss = Client::new(sw.port, "Alpha", "", Some((again.vip, &again.token)), Opts::default()).await;
    after_loss.welcome().await;
    assert_eq!(after_loss.vip, a.vip);
    assert_eq!(*gate.resumed.lock().unwrap(), vec![a.vip, a.vip]);
    x.close().await;
    after_loss.close().await;
    sw.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn host_membership_overrides_lan_claims_and_a_stalled_host_expires_routes() {
    let _serial = serial().await;
    let gate = Arc::new(Gate::default());
    let sw = start_full(opts(), "", Some(gate.clone()), None, None).await;
    let mut a = Client::connect(sw.port, "Alpha").await;
    let mut b = Client::connect(sw.port, "Bravo").await;
    a.welcome().await;
    b.welcome().await;
    *gate.state.lock().unwrap() = AvatarLinks { managed: [a.vip, b.vip].into(), ..Default::default() };
    for (c, room) in [(&a, "one"), (&b, "two")] {
        c.binary(frame(json!({"op":"join","version":1,"room":room,"cops":false})));
        c.until_true(|g| g.frames.iter().any(|(f, _)| f.first() == Some(&34))).await;
    }
    let update = |c: &Client, seq, other| c.binary(frame(json!({"op":"update","seq":seq,"avatar":null,"police":null,"peers":[other]})));
    update(&a, 1, b.vip);
    update(&b, 1, a.vip);
    sleep(350).await;
    assert!(!events(&a).iter().chain(events(&b).iter()).any(|e| e["op"] == "avatar"), "mutual claims cannot cross authoritative groups");
    gate.state.lock().unwrap().pairs = vec![(a.vip, b.vip)];
    sleep(350).await;
    assert!(events(&b).iter().any(|e| e["op"] == "avatar" && e["from"] == a.vip));
    update(&a, 2, b.vip);
    update(&b, 2, a.vip);
    sleep(100).await;
    assert!(!events(&a).iter().any(|e| e["op"] == "avatar"), "one-way discovery stays one-way");
    gate.hold.store(true, Ordering::Relaxed);
    sleep(1400).await;
    assert!(events(&b).iter().any(|e| e["op"] == "gone" && e["from"] == a.vip));
    assert_eq!(gate.pending.lock().unwrap().len(), 1, "a stalled host has only one pending query");
    update(&a, 3, b.vip);
    sleep(100).await;
    assert!(!events(&b).iter().any(|e| e["op"] == "avatar" && e["seq"] == 3));
    let old = gate.pending.lock().unwrap().pop().unwrap();
    let _ = old.send(gate.state.lock().unwrap().clone());
    sleep(350).await;
    assert!(!events(&b).iter().any(|e| e["op"] == "avatar" && e["seq"] == 3), "late answer cannot refresh a grant");
    gate.state.lock().unwrap().pairs.clear();
    gate.hold.store(false, Ordering::Relaxed);
    for pending in gate.pending.lock().unwrap().drain(..) {
        let _ = pending.send(gate.state.lock().unwrap().clone());
    }
    sleep(350).await;
    assert!(!events(&b).iter().any(|e| e["op"] == "avatar" && e["seq"] == 3));
    *gate.state.lock().unwrap() = AvatarLinks::default();
    update(&b, 3, a.vip);
    sleep(350).await;
    assert!(events(&a).iter().any(|e| e["op"] == "avatar" && e["from"] == b.vip), "unmanaged LAN uses reciprocal consent");
    a.text(r#"{"t":"lan","on":0}"#);
    sleep(350).await;
    update(&a, 4, b.vip);
    sleep(100).await;
    assert!(!events(&b).iter().any(|e| e["op"] == "avatar" && e["seq"] == 4), "closing LAN removes its grant");
    a.close().await;
    b.close().await;
    sw.close().await;
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn extension_is_consumed_by_switch_and_identity_comes_from_socket() {
    let _serial = serial().await;
    let sw = start(opts()).await;
    let mut a = Client::connect(sw.port, "VR driver").await;
    let mut b = Client::connect(sw.port, "Flat driver").await;
    a.welcome().await;
    b.welcome().await;
    a.binary(frame(json!({"op":"join","version":1,"room":"vr-test","cops":true})));
    a.until_true(|g| g.frames.iter().any(|(f, _)| f.first() == Some(&34))).await;
    b.binary(frame(json!({"op":"join","version":1,"room":"vr-test","cops":false})));
    b.until_true(|g| g.frames.iter().any(|(f, _)| f.first() == Some(&34))).await;
    assert!(events(&a).iter().any(|e| e["op"] == "joined" && e["you"] == a.vip));
    assert!(!events(&b).iter().any(|e| e["op"] == "authority"));
    a.binary(frame(json!({"op":"update","seq":0,"avatar":null,"police":null,"peers":[b.vip]})));
    sleep(350).await;
    assert!(!events(&b).iter().any(|e| e["op"] == "avatar"), "a room name or unilateral invitation is not membership");
    b.binary(frame(json!({"op":"update","seq":0,"avatar":null,"police":null,"peers":[a.vip]})));
    sleep(350).await;
    a.binary(frame(json!({"op":"update","seq":1,"avatar":null,"police":null,"peers":[b.vip]})));
    b.until_true(|g| {
        g.frames.iter().any(|(f, _)| {
            f.first() == Some(&34)
                && serde_json::from_slice::<Value>(&f[4..]).is_ok_and(|e| e["op"] == "avatar" && e["from"] == a.vip && e["seq"] == 1)
        })
    })
    .await;
    // Supplying a forged sender is rejected by the exact request schema.
    a.binary(frame(json!({"op":"update","from":b.vip,"seq":2,"avatar":null,"police":null})));
    sleep(60).await;
    assert!(!events(&b).iter().any(|e| e["op"] == "avatar" && e["from"] == b.vip));
    a.close().await;
    b.until_true(|g| {
        g.frames.iter().any(|(f, _)| {
            f.first() == Some(&34) && serde_json::from_slice::<Value>(&f[4..]).is_ok_and(|e| e["op"] == "gone" && e["from"] == a.vip)
        })
    })
    .await;
    b.close().await;
    sw.close().await;
}
