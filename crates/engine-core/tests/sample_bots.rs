use engine_core::{CabinetRushBot, GameConfig, GreedyCollectorBot, run_match};

#[test]
fn sample_bots_can_finish_a_match() {
    let (_, replay, summary) = run_match(
        123,
        GameConfig {
            max_turns: 50,
            ..GameConfig::default()
        },
        &GreedyCollectorBot,
        &CabinetRushBot,
    );

    assert_eq!(replay.frames.len(), 50);
    assert!(summary.final_scores[0] > 0 || summary.final_scores[1] > 0);
}

