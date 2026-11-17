mod kit;
use kit::*;
use nfsu2_roam::RoamOptions;

#[test]
fn avatar_links_follow_actual_world_blocks_and_requested_endpoints() {
    let mut k = Kit::new(RoamOptions::default());
    for (i, name, room) in [(0, &b"Anna"[..], 0), (1, &b"Bob"[..], 0), (2, &b"Carl"[..], 99)] {
        k.from(V(i), &hello_with(100 + i, &HelloOpts { name, core: 2, room, ..Default::default() }));
        k.from(V(i), &snap(100 + i, [i as f64 * 5., 0., 0.]));
    }
    k.hub.tick();
    let ids = [V(0), V(1), V(2), V(3)];
    let a = k.hub.avatar_links(&ids);
    assert_eq!(a.pairs, vec![(V(0), V(1)), (V(1), V(0))]);
    assert_eq!(a.cars, vec![(V(0), V(1), 100), (V(1), V(0), 101)]);
    assert_eq!(a.managed.len(), 3);
    assert!(!a.managed.contains(&V(3)));
    assert!(k.hub.avatar_links(&[V(0)]).pairs.is_empty());
    k.hub.blocks(V(0), vec!["bob".into()]);
    assert!(k.hub.avatar_links(&ids).pairs.is_empty(), "a new block applies before the next discovery tick");
    k.hub.peer_gone(V(1));
    let a = k.hub.avatar_links(&ids);
    assert!(!a.managed.contains(&V(1)));
}

#[test]
fn two_cars_of_one_browser_keep_separate_discovery_permissions() {
    let mut k = Kit::new(RoamOptions::default());
    for (vip, port, id, room, name, flags) in [
        (V(0), 47210, 77, 0, &b"Anna"[..], 0),
        (V(0), 47211, 88, 99, &b"Anna 2"[..], 0x2000),
        (V(1), 47210, 99, 0, &b"Bob"[..], 0),
        (V(2), 47210, 100, 99, &b"Carl"[..], 0),
    ] {
        let h = hello_with(id, &HelloOpts { room, name, flags, core: 12, crews: Some(&[]), links: 8, ..Default::default() });
        k.hub.frame(vip, &frame_ports(vip, &h, port, 47210));
        k.hub.frame(vip, &frame_ports(vip, &snap(id, [0., 0., 0.]), port, 47210));
    }
    k.hub.tick();
    let ids = [V(0), V(1), V(2)];
    let links = k.hub.avatar_links(&ids);
    assert!(links.cars.contains(&(V(0), V(1), 77)));
    assert!(links.cars.contains(&(V(0), V(2), 88)));
    assert!(!links.cars.contains(&(V(0), V(2), 77)));
    assert!(!links.cars.contains(&(V(0), V(1), 88)));
    k.hub.frame(V(0), &frame_ports(V(0), &bye(88), 47211, 47210));
    let links = k.hub.avatar_links(&ids);
    assert!(links.cars.contains(&(V(0), V(1), 77)));
    assert!(!links.cars.iter().any(|&(a, _, car)| a == V(0) && car == 88));
}

#[test]
fn avatar_directions_match_original_peer_lists_and_room_changes_apply_immediately() {
    let mut k = Kit::new(RoamOptions { view_m: 1e-9, ..RoamOptions::default() });
    let ids = [V(0), V(1), V(2), V(3)];
    for (i, p) in [[0., 0., 0.], [30., 0., 0.], [0., 40., 0.], [400., 0., 0.]].into_iter().enumerate() {
        k.from(V(i as u32), &hello_with(100 + i as u32, &HelloOpts { core: 16, links: if i == 0 { 2 } else { 8 }, ..Default::default() }));
        k.from(V(i as u32), &snap(100 + i as u32, p));
    }
    k.clear();
    k.hub.tick();
    let lists = lists_in(&k.sent.lock());
    let mut expected = Vec::new();
    for &to in &ids {
        for entry in &lists[&format!("{to}:47210")] {
            expected.push((entry.vip, to));
        }
    }
    expected.sort_unstable();
    expected.dedup();
    assert!(expected.iter().any(|(a, b)| !expected.contains(&(*b, *a))), "fixture must have one-way links");
    assert_eq!(k.hub.avatar_links(&ids).pairs, expected);
    k.from(V(0), &hello_with(100, &HelloOpts { core: 16, links: 2, room: 99, ..Default::default() }));
    assert!(!k.hub.avatar_links(&ids).pairs.iter().any(|(a, b)| *a == V(0) || *b == V(0)), "old links do not survive a changed world");
}
