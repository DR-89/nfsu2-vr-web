use nfsu2_vr::{Event, Hub};
use serde_json::{Value, json};

fn send(h: &mut Hub, who: u32, v: Value, now: u64) -> Vec<(u32, Event)> {
    h.receive(who, &serde_json::to_vec(&v).unwrap(), now)
}
fn join(h: &mut Hub, who: u32, room: &str, cops: bool, now: u64) -> Vec<(u32, Event)> {
    send(h, who, json!({"op":"join","version":1,"room":room,"cops":cops}), now)
}
fn update(seq: u32) -> Value {
    json!({"op":"update","seq":seq,"avatar":null,"police":null})
}

#[test]
fn routed_avatars_require_game_membership_not_room_names_and_expire_closed() {
    let mut h = Hub::routed();
    join(&mut h, 1, "guessed", false, 0);
    join(&mut h, 2, "guessed", false, 0);
    join(&mut h, 3, "different", false, 0);
    assert!(!send(&mut h, 1, update(1), 50).iter().any(|(_, e)| matches!(e, Event::Avatar { .. })));
    let members = h.members();
    let routes = h.set_routes(&members, vec![(1, 3, 0)], vec![], 100);
    assert!(routes.iter().any(|(v, e)| *v == 3 && matches!(e, Event::Avatar { from: 1, .. })));
    let out = send(&mut h, 1, update(2), 150);
    assert!(out.iter().any(|(v, e)| *v == 3 && matches!(e, Event::Avatar { .. })));
    assert!(!out.iter().any(|(v, _)| *v == 2));
    let out = send(&mut h, 1, update(3), 1100);
    assert!(out.iter().any(|(v, e)| *v == 3 && matches!(e, Event::Gone { from: 1 })));
    assert!(!out.iter().any(|(_, e)| matches!(e, Event::Avatar { .. })));
}

#[test]
fn delayed_routes_cannot_restore_a_rejoined_identity_or_a_left_world() {
    let mut h = Hub::routed();
    join(&mut h, 1, "a", false, 0);
    join(&mut h, 2, "a", false, 0);
    let old = h.members();
    h.set_routes(&old, vec![(1, 2, 0)], vec![], 10);
    h.leave(2, 20);
    join(&mut h, 2, "a", false, 30);
    assert!(h.set_routes(&old, vec![(1, 2, 0)], vec![], 40).is_empty());
    assert!(!send(&mut h, 1, update(1), 50).iter().any(|(_, e)| matches!(e, Event::Avatar { .. })));
    h.set_routes(&h.members(), vec![(1, 2, 0), (2, 1, 0)], vec![], 60);
    let removed = h.set_routes(&h.members(), vec![], vec![], 70);
    assert_eq!(removed.iter().filter(|(_, e)| matches!(e, Event::Gone { .. })).count(), 2);
    assert!(!send(&mut h, 1, update(2), 100).iter().any(|(_, e)| matches!(e, Event::Avatar { .. })));
}

#[test]
fn lan_consent_is_mutual_bounded_and_withdrawn_immediately() {
    let mut h = Hub::routed();
    join(&mut h, 1, "a", false, 0);
    join(&mut h, 2, "b", false, 0);
    let mut a = update(1);
    a["peers"] = json!([2]);
    send(&mut h, 1, a, 50);
    assert!(h.mutual_pairs().is_empty());
    let mut b = update(1);
    b["peers"] = json!([1]);
    send(&mut h, 2, b, 50);
    assert_eq!(h.mutual_pairs(), vec![(1, 2)]);
    h.set_routes(&h.members(), vec![], h.mutual_pairs(), 60);
    let mut a = update(2);
    a["peers"] = json!([2]);
    assert!(send(&mut h, 1, a, 100).iter().any(|(v, e)| *v == 2 && matches!(e, Event::Avatar { .. })));
    let out = send(&mut h, 2, update(2), 100);
    assert_eq!(out.iter().filter(|(_, e)| matches!(e, Event::Gone { .. })).count(), 2);
    assert!(!out.iter().any(|(_, e)| matches!(e, Event::Avatar { .. })));
    for peers in [json!([1]), json!([0]), json!([2, 2]), json!([2, 3, 4, 5, 6, 7, 8, 9, 10])] {
        let mut bad = update(3);
        bad["peers"] = peers;
        assert!(send(&mut h, 1, bad, 150).is_empty());
    }
}

#[test]
fn coop_poses_follow_exact_source_cars_and_revocation_clears_cached_tracking() {
    let mut h = Hub::routed();
    for who in 1..=3 {
        join(&mut h, who, "same", false, 0);
    }
    let avatar = |car| json!({"car":car,"cockpit":0,"vr":false,"head":{"p":[0,0,0],"q":[0,0,0,1]},"left":null,"right":null});
    let mut packet = update(1);
    packet["avatar"] = avatar(77);
    packet["secondary"] = avatar(88);
    send(&mut h, 1, packet.clone(), 50);
    let grants = vec![(1, 2, 77), (1, 3, 88)];
    let events = h.set_routes(&h.members(), grants.clone(), vec![], 100);
    assert!(events.iter().any(|(to, e)| *to == 2 && matches!(e,Event::Avatar{avatar:Some(a),secondary:None,..} if a.car==77)));
    assert!(events.iter().any(|(to, e)| *to == 3 && matches!(e,Event::Avatar{avatar:None,secondary:Some(a),..} if a.car==88)));
    packet["seq"] = json!(2);
    let events = send(&mut h, 1, packet.clone(), 150);
    assert!(events.iter().any(|(to, e)| *to == 2 && matches!(e,Event::Avatar{avatar:Some(a),secondary:None,..} if a.car==77)));
    assert!(events.iter().any(|(to, e)| *to == 3 && matches!(e,Event::Avatar{avatar:None,secondary:Some(a),..} if a.car==88)));
    assert!(h.set_routes(&h.members(), grants, vec![], 200).is_empty());
    let events = h.set_routes(&h.members(), vec![(1, 2, 88)], vec![], 250);
    assert!(matches!(events[0], (2, Event::Gone { from: 1 })));
    assert!(events.iter().any(|(to, e)| *to == 3 && matches!(e, Event::Gone { from: 1 })));
    assert!(events.iter().any(|(to, e)| *to == 2 && matches!(e,Event::Avatar{avatar:None,secondary:Some(a),..} if a.car==88)));
    packet["seq"] = json!(3);
    packet["secondary"] = Value::Null;
    assert!(
        send(&mut h, 1, packet.clone(), 300)
            .iter()
            .any(|(to, e)| *to == 2 && matches!(e, Event::Avatar { avatar: None, secondary: None, .. }))
    );
    for car in [0, 77] {
        packet["seq"] = json!(4);
        packet["secondary"] = avatar(car);
        assert!(send(&mut h, 1, packet.clone(), 350).is_empty());
    }
    packet["secondary"] = avatar(999);
    let events = send(&mut h, 1, packet, 400);
    assert!(
        events.iter().any(|(to, e)| *to == 2 && matches!(e, Event::Avatar { avatar: None, secondary: None, .. })),
        "ungranted car id is never forwarded"
    );
}
fn epoch(events: &[(u32, Event)]) -> u64 {
    events
        .iter()
        .find_map(|(_, e)| match e {
            Event::Authority { epoch, .. } => Some(*epoch),
            _ => None,
        })
        .unwrap()
}
fn police(seq: u32, epoch: u64, target: u32) -> Value {
    json!({"op":"update","seq":seq,"avatar":null,"police":{"epoch":epoch,"tick":seq,
        "cars":[{"id":1,"model":0,"pose":{"p":[1,2,3],"q":[0,0,0,1]},"velocity":[0,0,10],"target":target,"lights":true}]}})
}

#[test]
fn vr_and_flat_share_avatars_but_cops_are_opt_in_and_room_scoped() {
    let mut h = Hub::default();
    let e = epoch(&join(&mut h, 1, "race", true, 0));
    join(&mut h, 2, "race", true, 0);
    join(&mut h, 3, "race", false, 0);
    join(&mut h, 4, "elsewhere", true, 0);
    let out = send(&mut h, 1, police(1, e, 2), 50);
    assert!(out.iter().any(|(to, e)| *to == 2 && matches!(e, Event::Police { .. })));
    assert!(out.iter().any(|(to, e)| *to == 3 && matches!(e, Event::Avatar { .. })));
    assert!(!out.iter().any(|(to, e)| *to == 3 && matches!(e, Event::Police { .. } | Event::Authority { .. })));
    assert!(!out.iter().any(|(to, _)| *to == 4));
}

#[test]
fn only_elected_host_can_publish_and_targets_must_opt_in() {
    let mut h = Hub::default();
    let e = epoch(&join(&mut h, 1, "", true, 0));
    join(&mut h, 2, "", true, 0);
    join(&mut h, 3, "", false, 0);
    assert!(send(&mut h, 2, police(1, e, 1), 50).is_empty());
    assert!(send(&mut h, 1, police(1, e, 3), 50).is_empty());
    assert!(!send(&mut h, 1, police(1, e, 2), 50).is_empty());
}

#[test]
fn disconnect_hands_last_snapshot_to_next_host_and_rejects_old_epoch() {
    let mut h = Hub::default();
    let old = epoch(&join(&mut h, 1, "", true, 0));
    join(&mut h, 2, "", true, 0);
    send(&mut h, 1, police(1, old, 2), 50);
    let out = h.leave(1, 100);
    let new = epoch(&out);
    assert!(new > old);
    assert!(
        out.iter().any(|(to, e)| *to == 2 && matches!(e, Event::Authority { host: Some(2), police: Some(p), .. } if p.cars.len() == 1))
    );
    assert!(send(&mut h, 2, police(1, old, 2), 150).is_empty());
    send(&mut h, 2, police(1, new, 2), 150);
    let late = join(&mut h, 3, "", true, 160);
    assert!(late.iter().any(|(to, e)| *to == 3 && matches!(e, Event::Authority { police: Some(p), .. } if p.epoch == new)));
}

#[test]
fn silent_host_loses_lease_without_closing_websocket() {
    let mut h = Hub::default();
    let old = epoch(&join(&mut h, 1, "", true, 0));
    join(&mut h, 2, "", true, 0);
    send(&mut h, 2, update(1), 1900);
    let out = h.tick(2001);
    assert!(epoch(&out) > old);
    assert!(out.iter().any(|(_, e)| matches!(e, Event::Authority { host: Some(2), .. })));
    assert!(send(&mut h, 1, police(2, old, 2), 2050).is_empty());
}

#[test]
fn malformed_replayed_overrate_and_out_of_range_frames_are_dropped() {
    let mut h = Hub::default();
    join(&mut h, 1, "", false, 0);
    join(&mut h, 2, "", false, 0);
    assert!(!send(&mut h, 1, update(u32::MAX), 50).is_empty());
    assert!(send(&mut h, 1, update(u32::MAX), 100).is_empty());
    assert!(!send(&mut h, 1, update(0), 100).is_empty());
    assert!(send(&mut h, 1, update(1), 101).is_empty());
    let mut bad = update(1);
    bad["avatar"] = json!({"car":1,"cockpit":0,"vr":true,"head":{"p":[9999,0,0],"q":[0,0,0,1]},"left":null,"right":null});
    assert!(send(&mut h, 1, bad, 200).is_empty());
    assert!(h.receive(1, b"{", 200).is_empty());
    assert!(h.receive(1, &vec![b' '; 16_385], 200).is_empty());
}

#[test]
fn opting_out_and_room_change_remove_authority_and_old_avatar() {
    let mut h = Hub::default();
    join(&mut h, 1, "a", true, 0);
    join(&mut h, 2, "a", true, 0);
    let out = join(&mut h, 1, "a", false, 50);
    assert!(out.iter().any(|(to, e)| *to == 2 && matches!(e, Event::Authority { host: Some(2), .. })));
    let out = join(&mut h, 2, "b", true, 100);
    assert!(out.iter().any(|(to, e)| *to == 1 && matches!(e, Event::Gone { from: 2 })));
    assert!(!send(&mut h, 2, update(1), 150).iter().any(|(to, _)| *to == 1));
}

#[test]
fn retries_are_acknowledged_and_expired_members_can_rejoin() {
    let mut h = Hub::default();
    join(&mut h, 1, "room", true, 0);
    let repeated = join(&mut h, 1, "room", true, 100);
    assert!(repeated.iter().any(|(to, e)| *to == 1 && matches!(e, Event::Joined { .. })));
    let accepted = send(&mut h, 1, update(0), 200);
    assert!(accepted.iter().any(|(to, e)| *to == 1 && matches!(e, Event::Ack { seq: 0 })));
    h.tick(6000);
    assert!(send(&mut h, 1, update(1), 6100).is_empty());
    let rejoined = join(&mut h, 1, "room", true, 6200);
    assert!(rejoined.iter().any(|(to, e)| *to == 1 && matches!(e, Event::Joined { .. })));
}

#[test]
fn physical_wheel_angle_is_optional_bounded_and_shared_with_flat_players() {
    let mut h = Hub::default();
    join(&mut h, 1, "race", false, 0);
    join(&mut h, 2, "race", false, 0);
    let mut frame = update(1);
    frame["avatar"] = json!({"car":1,"cockpit":256,"vr":true,"head":null,"left":null,"right":null,"wheel":2.5,"shifter":[0.045,-0.06],"pedals":[0.7,0.1,1.0]});
    let out = send(&mut h, 1, frame.clone(), 50);
    assert!(out.iter().any(|(to, e)| *to == 2 && matches!(e, Event::Avatar { avatar: Some(a), .. } if a.wheel == Some(2.5))));
    // Late arrivals receive the same wheel contact, not the sensitivity-scaled car steering.
    let late = join(&mut h, 3, "race", false, 60);
    assert!(late.iter().any(|(to, e)| *to == 3 && matches!(e, Event::Avatar { avatar: Some(a), .. } if a.wheel == Some(2.5) && a.shifter == Some([0.045,-0.06]) && a.pedals == Some([0.7,0.1,1.0]))));
    frame["seq"] = json!(2);
    frame["avatar"]["wheel"] = json!(3.1);
    assert!(send(&mut h, 1, frame.clone(), 100).is_empty());
    frame["avatar"].as_object_mut().unwrap().remove("wheel");
    frame["avatar"]["shifter"] = json!([0.11, 0.0]);
    assert!(send(&mut h, 1, frame.clone(), 150).is_empty());
    frame["avatar"].as_object_mut().unwrap().remove("shifter");
    frame["avatar"]["pedals"] = json!([0.0, -0.1, 1.0]);
    assert!(send(&mut h, 1, frame.clone(), 200).is_empty());
    frame["avatar"].as_object_mut().unwrap().remove("pedals");
    let legacy = send(&mut h, 1, frame, 250);
    assert!(legacy.iter().any(|(to, e)| *to == 2 && matches!(e, Event::Avatar { avatar: Some(a), .. } if a.wheel.is_none())));
}

#[test]
fn finger_poses_are_bounded_shared_and_optional_for_legacy_clients() {
    let mut h = Hub::default();
    join(&mut h, 1, "race", false, 0);
    join(&mut h, 2, "race", false, 0);
    let mut frame = update(1);
    frame["avatar"] = json!({"car":1,"cockpit":0,"vr":true,"head":null,"left":null,"right":null,"fingers":[0.0,0.0,1.0,1.0]});
    let out = send(&mut h, 1, frame.clone(), 50);
    assert!(
        out.iter().any(|(to, e)| *to == 2 && matches!(e, Event::Avatar { avatar: Some(a), .. } if a.fingers == Some([0.0,0.0,1.0,1.0])))
    );
    let late = join(&mut h, 3, "race", false, 60);
    assert!(
        late.iter().any(|(to, e)| *to == 3 && matches!(e, Event::Avatar { avatar: Some(a), .. } if a.fingers == Some([0.0,0.0,1.0,1.0])))
    );
    frame["seq"] = json!(2);
    for bad in [json!([1.1, 0, 0, 0]), json!([-0.1, 0, 0, 0]), json!([0, 0, 0]), json!([0, 0, 0, 0, 0]), json!(["1", 0, 0, 0])] {
        frame["avatar"]["fingers"] = bad;
        assert!(send(&mut h, 1, frame.clone(), 100).is_empty());
    }
    frame["avatar"].as_object_mut().unwrap().remove("fingers");
    let legacy = send(&mut h, 1, frame, 150);
    assert!(legacy.iter().any(|(to, e)| *to == 2 && matches!(e, Event::Avatar { avatar: Some(a), .. } if a.fingers.is_none())));
}
