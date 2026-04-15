use engine_core::{CabinetRushBot, GameConfig, GreedyCollectorBot, run_match};

#[test]
fn replay_collects_frames_and_summary() {
    let (_, replay, summary) = run_match(
        99,
        GameConfig {
            max_turns: 5,
            ..GameConfig::default()
        },
        &GreedyCollectorBot,
        &CabinetRushBot,
    );

    assert_eq!(replay.seed, 99);
    assert_eq!(replay.frames.len(), 5);
    assert!(replay.summary.is_some());
    assert_eq!(replay.summary.unwrap().final_scores, summary.final_scores);
}
