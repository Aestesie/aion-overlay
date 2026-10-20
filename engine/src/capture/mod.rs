//! Packet capture: live from the network (`pcap_capturer`, through Npcap or
//! libpcap) or from a recording (`recording`), routed to the parser by the
//! dispatcher. Everything but `recording` is copied from A2Tools DPS Meter.

// The copied files keep upstream's functions we don't call yet, so they stay
// easy to diff against upstream.
#[allow(dead_code)]
pub mod combat_port_detector;
#[allow(dead_code)]
pub mod dispatcher;
#[allow(dead_code)]
pub mod pcap_capturer;
pub mod pcap_lib;
pub mod recording;
