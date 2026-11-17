//! Versioned room state carried over the existing authenticated LAN connection.
//! The switch supplies the sender's identity. A client never chooses a sender or
//! a police authority. Physics runs on one opted-in client; snapshots, including
//! the last one before a handover, are shared by all opted-in room members.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const VERSION: u32 = 1;
pub const MAX_MEMBERS: usize = 32;
pub const MAX_COPS: usize = 16;
pub const MAX_BYTES: usize = 16_384;
const LEASE_MS: u64 = 2_000;
const MEMBER_MS: u64 = 5_000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Pose {
    pub p: [f32; 3],
    pub q: [f32; 4],
}
impl Pose {
    fn valid(&self, bound: f32) -> bool {
        let norm: f32 = self.q.iter().map(|x| x * x).sum();
        self.p.iter().all(|x| x.is_finite() && x.abs() <= bound) && self.q.iter().all(|x| x.is_finite()) && (0.9..=1.1).contains(&norm)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Avatar {
    /// The free-roam car id, checked against the car mapping by receivers.
    pub car: u32,
    pub cockpit: u16,
    pub vr: bool,
    /// Car-local metres: right, up, backwards. None means tracking is lost.
    pub head: Option<Pose>,
    pub left: Option<Pose>,
    pub right: Option<Pose>,
    /// Physical rim angle / pi, separate from the sensitivity-scaled car steer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wheel: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shifter: Option<[f32; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pedals: Option<[f32; 3]>,
    /// Left curl/index extension, then right; legacy packets keep the grip pose.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fingers: Option<[f32; 4]>,
}
impl Avatar {
    fn valid(&self) -> bool {
        self.wheel.is_none_or(|v| v.is_finite() && v.abs() <= 3.0)
            && self.shifter.is_none_or(|p| p.iter().all(|v| v.is_finite() && v.abs() <= 0.1))
            && self.pedals.is_none_or(|p| p.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v)))
            && self.fingers.is_none_or(|p| p.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v)))
            && [&self.head, &self.left, &self.right].iter().all(|p| p.as_ref().is_none_or(|p| p.valid(4.0)))
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Cop {
    pub id: u16,
    pub model: u16,
    pub pose: Pose,
    pub velocity: [f32; 3],
    pub target: u32,
    pub lights: bool,
}
impl Cop {
    fn valid(&self) -> bool {
        self.id != 0 && self.pose.valid(100_000.0) && self.velocity.iter().all(|x| x.is_finite() && x.abs() <= 200.0)
    }
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Join {
        version: u32,
        room: String,
        cops: bool,
    },
    Update {
        seq: u32,
        avatar: Option<Avatar>,
        #[serde(default)]
        secondary: Option<Box<Avatar>>,
        police: Option<Box<Police>>,
        /// Original-game race peers, for reciprocal consent in hostless LAN play.
        #[serde(default)]
        peers: Vec<u32>,
    },
    Leave,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Police {
    pub epoch: u64,
    pub tick: u32,
    /// Full snapshot: omission despawns a vehicle, including an empty list.
    pub cars: Vec<Cop>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Event {
    Joined {
        version: u32,
        you: u32,
        room: String,
    },
    Ack {
        seq: u32,
    },
    Avatar {
        from: u32,
        seq: u32,
        avatar: Option<Avatar>,
        #[serde(skip_serializing_if = "Option::is_none")]
        secondary: Option<Box<Avatar>>,
    },
    Gone {
        from: u32,
    },
    Authority {
        host: Option<u32>,
        epoch: u64,
        police: Option<Police>,
    },
    Police {
        host: u32,
        police: Police,
    },
    Rejected {
        reason: &'static str,
    },
}
pub type Delivery = (u32, Event);
struct Member {
    room: String,
    cops: bool,
    seen: u64,
    last_update: Option<u64>,
    seq: Option<u32>,
    avatar: Option<Avatar>,
    secondary: Option<Box<Avatar>>,
    generation: u64,
    peers: BTreeSet<u32>,
}
#[derive(Default, PartialEq, Eq)]
struct Route {
    /// true: a LAN pair must still consent in both directions.
    consent: bool,
    cars: BTreeSet<u32>,
}
#[derive(Default)]
struct Routing {
    pairs: BTreeMap<(u32, u32), Route>,
    until: u64,
}
#[derive(Default)]
struct Room {
    host: Option<u32>,
    epoch: u64,
    host_seen: u64,
    police: Option<Police>,
    tick: Option<u32>,
}
#[derive(Default)]
pub struct Hub {
    members: BTreeMap<u32, Member>,
    rooms: BTreeMap<String, Room>,
    epoch: u64,
    generation: u64,
    routing: Option<Routing>,
}
fn newer(next: u32, last: u32) -> bool {
    next.wrapping_sub(last) as i32 > 0
}

impl Hub {
    /// Production avatar routing fails closed until the game hosts answer.
    pub fn routed() -> Self {
        Self { routing: Some(Routing::default()), ..Self::default() }
    }
    pub fn members(&self) -> Vec<(u32, u64)> {
        self.members.iter().map(|(&v, m)| (v, m.generation)).collect()
    }
    pub fn mutual_pairs(&self) -> Vec<(u32, u32)> {
        self.members
            .iter()
            .flat_map(|(&a, m)| {
                m.peers
                    .iter()
                    .copied()
                    .filter(move |&b| a < b)
                    .filter(move |b| self.members.get(b).is_some_and(|m| m.peers.contains(&a)))
                    .map(move |b| (a, b))
            })
            .collect()
    }
    fn routed_pair(&self, a: u32, b: u32) -> bool {
        self.routing.as_ref().is_some_and(|r| r.pairs.contains_key(&(a, b)))
    }
    fn visible(&self, a: u32, b: u32) -> bool {
        if let Some(r) = &self.routing {
            r.pairs.get(&(a, b)).is_some_and(|route| {
                !route.consent
                    || self.members.get(&a).is_some_and(|m| m.peers.contains(&b))
                        && self.members.get(&b).is_some_and(|m| m.peers.contains(&a))
            })
        } else {
            self.members.get(&a).zip(self.members.get(&b)).is_some_and(|(a, b)| a.room == b.room)
        }
    }
    fn avatar_event(&self, from: u32, to: u32, seq: u32, avatar: &Option<Avatar>, secondary: &Option<Box<Avatar>>) -> Event {
        let allowed = |a: &&Avatar| self.routing.as_ref().is_none_or(|r| r.pairs.get(&(from, to)).is_some_and(|p| p.cars.contains(&a.car)));
        Event::Avatar {
            from,
            seq,
            avatar: avatar.as_ref().filter(allowed).cloned(),
            secondary: secondary.as_deref().filter(allowed).cloned().map(Box::new),
        }
    }
    fn gone_pair(a: u32, b: u32, out: &mut Vec<Delivery>) {
        out.push((b, Event::Gone { from: a }));
    }
    fn expire_routes(&mut self, now: u64) -> Vec<Delivery> {
        let mut out = Vec::new();
        if let Some(r) = &mut self.routing
            && now >= r.until
        {
            for ((a, b), _) in std::mem::take(&mut r.pairs) {
                Self::gone_pair(a, b, &mut out);
            }
        }
        out
    }
    /// A single host query is at most one second old. Membership generations
    /// prevent its delayed answer from authorizing a leave/rejoin in between.
    pub fn set_routes(&mut self, expected: &[(u32, u64)], server: Vec<(u32, u32, u32)>, lan: Vec<(u32, u32)>, now: u64) -> Vec<Delivery> {
        let valid: BTreeSet<_> =
            expected.iter().filter(|(v, g)| self.members.get(v).is_some_and(|m| m.generation == *g)).map(|(v, _)| *v).collect();
        let mut pairs: BTreeMap<_, _> = lan
            .into_iter()
            .flat_map(|(a, b)| [(a, b), (b, a)])
            .filter(|(a, b)| a != b && valid.contains(a) && valid.contains(b))
            .map(|pair| (pair, Route { consent: true, cars: [0].into() }))
            .collect();
        for (a, b, car) in server.into_iter().filter(|(a, b, _)| a != b && valid.contains(a) && valid.contains(b)) {
            let route = pairs.entry((a, b)).or_default();
            if route.consent {
                route.cars.clear();
                route.consent = false;
            }
            route.cars.insert(car);
        }
        let Some(r) = &mut self.routing else { return Vec::new() };
        let old = std::mem::replace(&mut r.pairs, pairs);
        r.until = now.saturating_add(1000);
        let mut out = Vec::new();
        for (&(a, b), route) in &old {
            if r.pairs.get(&(a, b)) != Some(route) {
                Self::gone_pair(a, b, &mut out);
            }
        }
        let changed: Vec<_> = r.pairs.iter().filter(|(key, route)| old.get(key) != Some(*route)).map(|(&pair, _)| pair).collect();
        for (from, to) in changed {
            if let Some(m) = self.members.get(&from).filter(|m| m.last_update.is_some_and(|t| now.saturating_sub(t) < 2000)) {
                out.push((to, self.avatar_event(from, to, m.seq.unwrap_or(0), &m.avatar, &m.secondary)));
            }
        }
        out
    }
    /// Decode with bounded input. Invalid frames do not refresh membership or leases.
    pub fn receive(&mut self, from: u32, bytes: &[u8], now: u64) -> Vec<Delivery> {
        if bytes.len() > MAX_BYTES {
            return Vec::new();
        }
        let Ok(req) = serde_json::from_slice::<Request>(bytes) else { return Vec::new() };
        let mut out = self.expire_routes(now);
        match req {
            Request::Join { version, room, cops } => {
                if version != VERSION || room.len() > 63 || room.chars().any(char::is_control) {
                    out.push((from, Event::Rejected { reason: "version_or_room" }));
                    return out;
                }
                if self.members.get(&from).is_some_and(|m| m.room == room && m.cops == cops) {
                    // Repeating Join is harmless; only an Update renews a police lease.
                    self.members.get_mut(&from).unwrap().seen = now;
                    out.push((from, Event::Joined { version: VERSION, you: from, room: room.clone() }));
                    if cops {
                        out.push((from, self.authority(&room)));
                    }
                    return out;
                }
                if self.members.len() >= 1024
                    || self.routing.is_none() && self.members.values().filter(|m| m.room == room).count() >= MAX_MEMBERS
                {
                    out.push((from, Event::Rejected { reason: "room_full" }));
                    return out;
                }
                out.extend(self.leave(from, now));
                out.push((from, Event::Joined { version: VERSION, you: from, room: room.clone() }));
                for (&who, m) in &self.members {
                    if self.routing.is_none() && m.room == room {
                        out.push((from, self.avatar_event(who, from, m.seq.unwrap_or(0), &m.avatar, &m.secondary)));
                    }
                }
                self.generation = self.generation.wrapping_add(1).max(1);
                self.members.insert(
                    from,
                    Member {
                        room: room.clone(),
                        cops,
                        seen: now,
                        last_update: None,
                        seq: None,
                        avatar: None,
                        secondary: None,
                        generation: self.generation,
                        peers: BTreeSet::new(),
                    },
                );
                self.rooms.entry(room.clone()).or_default();
                out.extend(self.elect(&room, now));
                if cops {
                    out.push((from, self.authority(&room)));
                }
            }
            Request::Update { seq, avatar, secondary, police, peers } => {
                let police = police.map(|p| *p);
                let Some(m) = self.members.get(&from) else { return out };
                if m.seq.is_some_and(|s| !newer(seq, s))
                    || m.last_update.is_some_and(|t| now.saturating_sub(t) < 45)
                    || avatar.as_ref().is_some_and(|a| !a.valid())
                    || secondary.as_ref().is_some_and(|a| !a.valid() || a.car == 0 || avatar.as_ref().is_some_and(|p| p.car == a.car))
                    || peers.len() > 8
                    || peers.iter().any(|v| *v == 0 || *v == from)
                    || peers.iter().collect::<BTreeSet<_>>().len() != peers.len()
                {
                    return out;
                }
                let room_name = m.room.clone();
                let room = &self.rooms[&room_name];
                if let Some(p) = &police {
                    let mut ids = BTreeSet::new();
                    if !m.cops
                        || room.host != Some(from)
                        || p.epoch != room.epoch
                        || room.tick.is_some_and(|t| !newer(p.tick, t))
                        || p.cars.len() > MAX_COPS
                        || p.cars.iter().any(|c| {
                            !c.valid() || !ids.insert(c.id) || !self.members.get(&c.target).is_some_and(|t| t.cops && t.room == room_name)
                        })
                    {
                        return out;
                    }
                }
                let m = self.members.get_mut(&from).unwrap();
                m.seen = now;
                m.last_update = Some(now);
                m.seq = Some(seq);
                m.avatar = avatar.clone();
                m.secondary = secondary.clone();
                m.peers = peers.into_iter().collect();
                if let Some(r) = &mut self.routing {
                    let gone: Vec<_> = r
                        .pairs
                        .iter()
                        .filter(|(_, route)| route.consent)
                        .map(|(&p, _)| p)
                        .filter(|(a, b)| {
                            !self.members.get(a).is_some_and(|m| m.peers.contains(b))
                                || !self.members.get(b).is_some_and(|m| m.peers.contains(a))
                        })
                        .collect();
                    for (a, b) in gone {
                        r.pairs.remove(&(a, b));
                        Self::gone_pair(a, b, &mut out);
                    }
                }
                let room = self.rooms.get_mut(&room_name).unwrap();
                if room.host == Some(from) {
                    room.host_seen = now;
                }
                if let Some(p) = &police {
                    room.tick = Some(p.tick);
                    room.police = Some(p.clone());
                }
                out.push((from, Event::Ack { seq }));
                for (&to, m) in &self.members {
                    if to == from {
                        continue;
                    }
                    if self.visible(from, to) {
                        out.push((to, self.avatar_event(from, to, seq, &avatar, &secondary)));
                    }
                    if m.room == room_name
                        && m.cops
                        && let Some(p) = &police
                    {
                        out.push((to, Event::Police { host: from, police: p.clone() }));
                    }
                }
            }
            Request::Leave => out.extend(self.leave(from, now)),
        }
        out
    }
    pub fn leave(&mut self, from: u32, now: u64) -> Vec<Delivery> {
        let Some(m) = self.members.remove(&from) else { return Vec::new() };
        let mut out: Vec<_> = self
            .members
            .iter()
            .filter(|(to, p)| if self.routing.is_some() { self.routed_pair(from, **to) } else { p.room == m.room })
            .map(|(&to, _)| (to, Event::Gone { from }))
            .collect();
        if let Some(r) = &mut self.routing {
            r.pairs.retain(|(a, b), _| *a != from && *b != from);
        }
        out.extend(self.elect(&m.room, now));
        if !self.members.values().any(|p| p.room == m.room) {
            self.rooms.remove(&m.room);
        }
        out
    }
    pub fn tick(&mut self, now: u64) -> Vec<Delivery> {
        let stale: Vec<_> = self.members.iter().filter(|(_, m)| now.saturating_sub(m.seen) >= MEMBER_MS).map(|(&v, _)| v).collect();
        let mut out = self.expire_routes(now);
        for v in stale {
            out.extend(self.leave(v, now));
        }
        for room in self.rooms.keys().cloned().collect::<Vec<_>>() {
            out.extend(self.elect(&room, now));
        }
        out
    }
    fn authority(&self, room: &str) -> Event {
        let r = &self.rooms[room];
        Event::Authority { host: r.host, epoch: r.epoch, police: r.police.clone() }
    }
    fn elect(&mut self, name: &str, now: u64) -> Vec<Delivery> {
        let Some(r) = self.rooms.get_mut(name) else { return Vec::new() };
        let eligible = |who: u32| self.members.get(&who).is_some_and(|m| m.cops && m.room == name && now.saturating_sub(m.seen) < LEASE_MS);
        if r.host.is_some_and(|h| eligible(h) && now.saturating_sub(r.host_seen) < LEASE_MS) {
            return Vec::new();
        }
        let host = self.members.keys().copied().find(|&h| eligible(h) && Some(h) != r.host);
        if host == r.host {
            return Vec::new();
        }
        self.epoch += 1;
        r.epoch = self.epoch;
        r.host = host;
        r.host_seen = now;
        r.tick = None;
        // A snapshot is a handover seed. Its original epoch remains visible; a new
        // host must publish the newly granted epoch before replicas resume physics.
        if host.is_none() {
            r.police = None;
        }
        let event = self.authority(name);
        self.members.iter().filter(|(_, m)| m.cops && m.room == name).map(|(&to, _)| (to, event.clone())).collect()
    }
}
