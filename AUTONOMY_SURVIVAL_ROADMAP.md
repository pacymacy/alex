# Alex Agent: Autonomy + Survival Roadmap

Status: Draft v1  
Scope: Long-horizon, high-cost, high-capability roadmap focused on autonomous survival gameplay in Minecraft Java.

## Implementation Status (Live)

Legend: `[x] implemented`, `[ ] planned`, `[~] partial`

1. [x] Personality runtime foundation (`personality.active`, policies, hot-swap lock, persona telemetry).
2. [x] In-game persona command family (`!alex persona list|set|stage|lock|unlock`).
3. [x] Cave Dweller staged autonomy: CD-0, CD-1, CD-2, and CD-3 baseline.
4. [x] Mining accuracy hardening: required harvest tool equip + expected-drop validation.
5. [x] Structured action result schema with machine-readable failure reason codes.
6. [x] Deterministic regression scenario runner for autonomy-critical loops.
7. [x] Missing-tool and inventory-full recovery: low-slot cleanup with low-value drop strategy.
8. [x] Night shelter routine with active light placement is implemented.
9. [x] Postcondition coverage for high-risk actions (`craft_item`, `place_block`, `eat_food`, `goto_waypoint`) is implemented.

---

## 1) Product Goal

Build a Minecraft survival agent that can:

1. Stay alive for very long sessions without human rescue.
2. Progress through survival tech tiers reliably (wood -> stone -> iron -> diamond -> nether/end readiness).
3. Build and maintain functional bases.
4. Recover from failures (death, lost gear, hostile attacks, terrain traps, bad plans).
5. Accept interactive player commands without collapsing autonomous behavior.

Primary success definition:

1. Agent survives and progresses for 6+ uninterrupted hours in a fresh survival world.
2. Agent can be interrupted by owner commands and then return to its long-term mission.
3. Agent can explain current objective, risk, and next actions at any point.

---

## 2) Program Shape (Big/Expensive Version)

Estimated scale:

1. 9-15 months of active development.
2. 2-5 engineers (agent runtime, planning systems, infra/eval, gameplay logic).
3. Dedicated compute + eval environment (nightly runs, replay analysis, regression suite).
4. Iterative online + offline policy improvements.

High-level budget categories:

1. API spend (LLM planning + diagnostics + reflection loops).
2. Compute for batch simulation and evaluation.
3. Engineering time for robust behavior trees + memory + tooling.
4. Ops/telemetry stack for long-run reliability.

---

## 3) Architecture Pillars

The roadmap assumes a hybrid architecture:

1. Deterministic Skills Layer:
   - Craft, mine, move, fight, build, inventory ops.
   - Strict postconditions + failure reporting.

2. Tactical Planner Layer:
   - Short-horizon plan generation.
   - Uses world state + active mission + safety policy.

3. Strategic Mission Layer:
   - Long-horizon objective decomposition.
   - Chooses macro goals (secure shelter, iron rush, food farming, etc.).

4. Memory + World Model Layer:
   - Waypoints, known resources, hazards, bases, toolchains.
   - Persistent state across restarts.

5. Safety Governor Layer:
   - Overrides all layers under danger conditions.
   - Hard constraints (health, food, armor, daylight, hostile proximity).

6. Evaluation + Telemetry Layer:
   - Run scoring, failure taxonomy, replay traces, deterministic regressions.

---

## 4) Development Phases

## Phase 0: Reliability Hardening (Immediate)

Goal: remove false positives and action ambiguity.

Deliverables:

1. Action postconditions for all high-risk actions:
   - `mine_block`, `craft_item`, `place_block`, `eat_food`, `goto_waypoint`.
2. Structured failure reasons:
   - `NO_TOOL`, `NO_PATH`, `NO_DROP`, `NO_RECIPE`, `DANGER_ABORT`, `TIMEOUT`.
3. Deterministic retry policy with limits and backoff.
4. Inventory full detection and auto-clear strategy.

Acceptance criteria:

1. No action returns success without measurable state change.
2. 95%+ of failures are classified with machine-readable reason codes.
3. Autonomy loop never hangs indefinitely on a single subtask.

---

## Phase 1: Survival Core v2

Goal: keep agent alive in early/mid game without babysitting.

Deliverables:

1. Hunger/health policy:
   - Food reserve thresholds.
   - Emergency food prioritization.
2. Night policy:
   - Decide between shelter, torch perimeter, or bed usage.
3. Hostile response matrix:
   - Flee vs fight decisions by gear, health, enemy type/count.
4. Death recovery bootstrap:
   - Re-equip sequence and return-to-death waypoint.

Acceptance criteria:

1. 1-hour survival in random seeds without owner intervention.
2. Successful recovery from at least one scripted death event.
3. >80% reduction in deaths caused by predictable hazards (night exposure, starvation).

---

## Phase 2: Resource Economy Engine

Goal: reliable material pipeline with stock targets.

Deliverables:

1. Resource stock model:
   - Desired min/max inventory levels by progression stage.
2. Gathering workflows:
   - Wood, cobblestone, coal, iron, food staples.
3. Smelting orchestration:
   - Furnace management, fuel budgeting, output collection.
4. Tool/armor lifecycle:
   - Craft, equip, replace by durability thresholds.

Acceptance criteria:

1. Agent can self-maintain toolchain for 2+ hours.
2. Agent reaches stable iron tier in most test runs.
3. Resource starvation events drop below defined threshold.

---

## Phase 3: Base Establishment and Maintenance

Goal: autonomous home construction and upkeep.

Deliverables:

1. Site selection heuristics:
   - Safety, proximity to resources, biome suitability.
2. Blueprint system v1:
   - Starter shelter, storage room, furnace corner, farm patch.
3. Build executor:
   - Block-by-block placement with correction/retry.
4. Base maintenance routines:
   - Lighting checks, chest organization, furnace top-off, perimeter scan.

Acceptance criteria:

1. Agent builds functional starter base in fresh world.
2. Base remains lit and usable after 2-night cycles.
3. Agent can return to base from exploration range.

---

## Phase 4: Mission Planner (Strategic)

Goal: long-horizon progression with explicit stage transitions.

Deliverables:

1. Stage graph:
   - Bootstrap -> Early survival -> Iron stability -> Diamond prep -> Nether prep.
2. Mission decomposition:
   - Each stage broken into measurable subgoals.
3. Interruption-safe mission queue:
   - Owner commands insert temporary tasks without losing strategic context.
4. Reflection loop:
   - “What failed? what changed? what to do next?”

Acceptance criteria:

1. Agent reaches defined stage transitions autonomously.
2. Mission queue recovers correctly after manual chat interruptions.
3. Planner avoids repeated failed subtasks beyond retry budget.

---

## Phase 5: Exploration and Mapping

Goal: broaden world knowledge without self-destruction.

Deliverables:

1. Exploration policy:
   - Radius expansion, return triggers, risk budgets.
2. Map memory:
   - Resource hotspots, villages, caves, danger zones.
3. Route caching:
   - Reusable paths between base and high-value areas.
4. Expedition packs:
   - Ensure required supplies before long-range travel.

Acceptance criteria:

1. Agent can perform multi-trip exploration and return safely.
2. Hotspot memory improves resource acquisition efficiency over baseline.
3. Fewer “lost far from base” terminations.

---

## Phase 6: Combat and Defense v2

Goal: survive combat scenarios consistently.

Deliverables:

1. Threat scoring model:
   - Mob type, count, distance, terrain, available gear.
2. Combat micro:
   - Kiting, shield usage (if implemented), retreat timing.
3. Defensive build tactics:
   - Emergency pillar, barrier placement, chokepoints.
4. Safe cave protocol:
   - Entry checks, torching path, retreat marker system.

Acceptance criteria:

1. Significant reduction in combat deaths over long runs.
2. Agent can clear low-risk engagements when advantageous.
3. Agent aborts risky engagements instead of greed-failing.

---

## Phase 7: Agriculture + Sustainability

Goal: renewable supplies and long-term stability.

Deliverables:

1. Basic crop farm automation:
   - Wheat/carrot/potato loop.
2. Animal interaction policy:
   - Optional breeding/slaughter logic with humane stock minimums.
3. Fuel sustainability:
   - Charcoal/coal inventory targets.
4. Consumables pipeline:
   - Bread/cooked foods with reserve thresholds.

Acceptance criteria:

1. Agent sustains food supply indefinitely in controlled runs.
2. Starvation becomes rare edge case.
3. Farm maintenance recovers from partial damage.

---

## Phase 8: Mid/Late Game Progression

Goal: transition beyond early survival.

Deliverables:

1. Diamond acquisition routines.
2. Enchant prep and XP gathering strategy.
3. Nether readiness checklist:
   - Gear, food, waypoints, return strategy.
4. Nether-safe expedition behavior.

Acceptance criteria:

1. Agent reaches diamond tier in a majority of long runs.
2. Agent survives initial nether entry and returns with value.
3. Catastrophic wipe rate stays below threshold.

---

## Phase 9: Self-Improvement Loop

Goal: continuous autonomous behavior improvement.

Deliverables:

1. Failure replay extraction:
   - Compact traces for postmortem prompts.
2. Automated policy tuning suggestions:
   - Threshold updates, skill fallback ordering, risk policy adjustments.
3. Nightly benchmark suite:
   - Seed set + scenario set + scorecards.
4. Guarded config evolution:
   - Only adopt proven policy deltas.

Acceptance criteria:

1. Weekly measurable improvement in benchmark score.
2. Regressions auto-detected before merge.
3. Policy updates can be rolled back safely.

---

## 5) Core Workstreams (Parallel)

## A) Runtime/Skills

1. High-fidelity action postconditions.
2. Skill preconditions and tool checks.
3. Timeouts, retries, and fallback actions.
4. Deterministic scenario tests.

## B) Planning/Reasoning

1. Tactical JSON planner contract refinement.
2. Strategic mission state machine.
3. Reflection and replanning under failure.
4. Multi-provider behavior stability checks.

## C) Memory/Knowledge

1. Persistent waypoint/resource memory schema.
2. Temporal memory with confidence decay.
3. Hazard memory (death spots, caves, hostile clusters).
4. Versioned memory migrations.

## D) Safety Systems

1. Hard safety constraints and interrupt priority.
2. Threat detection confidence model.
3. Panic protocols.
4. Recovery and safe-mode operation.

## E) Evaluation/Infra

1. Seeded reproducible test harness.
2. Scenario tests for each critical failure class.
3. Run telemetry and dashboarding.
4. Cost/latency/performance analytics.

---

## 6) Testing Strategy (Large)

Test pyramid:

1. Unit tests:
   - Tool selection, inventory math, mission transitions, retry logic.
2. Simulation tests:
   - Scripted worlds/events for deterministic behavior validation.
3. Soak tests:
   - Long autonomous runs (2h, 4h, 8h).
4. Adversarial tests:
   - Sudden attacks, food scarcity, blocked paths, missing tools.

Must-have scenario suite:

1. “No-pickaxe stone mining” should fail correctly.
2. “Inventory full while mining valuable ore” recovery.
3. “Nightfall during far exploration” safe return/shelter.
4. “Death during expedition” rebuild + recover.
5. “Owner interruption spam” mission stability.

---

## 7) Metrics and Scorecards

Primary KPIs:

1. Survival time (median, p90).
2. Progression depth reached per run.
3. Deaths per hour by cause.
4. Task success rate by action type.
5. Mean time to recovery after failure.

Secondary KPIs:

1. Resource throughput per hour.
2. Base integrity uptime.
3. Autonomous uptime ratio vs paused/manual.
4. API cost per hour and per progression stage.

---

## 8) Risk Register

Top risks:

1. Planner hallucinations causing unsafe actions.
2. False success reporting in skills.
3. High API variance causing unstable long-run policy.
4. Memory corruption/drift across sessions.
5. Cost explosion from excessive replanning.

Mitigations:

1. More deterministic skill logic and strict validators.
2. Hard safety overrides independent from planner output.
3. Provider fallback + prompt contract hardening.
4. Versioned memory and integrity checks.
5. Adaptive planning interval + budget guards.

---

## 9) Milestones (Example Calendar)

M1 (Month 1-2):

1. Reliability hardening complete.
2. Survival core v2 stable.
3. First benchmark dashboard.

M2 (Month 3-4):

1. Resource economy engine.
2. Base establishment v1.
3. 2-hour stable runs.

M3 (Month 5-6):

1. Strategic mission planner.
2. Exploration mapping.
3. 4-hour stable runs.

M4 (Month 7-9):

1. Combat/defense v2.
2. Agriculture sustainability.
3. 6-hour stable runs.

M5 (Month 10+):

1. Mid/late game progression.
2. Self-improvement loop.
3. Continuous benchmark optimization.

---

## 10) Concrete Backlog (Next 30 Tickets)

Priority P0:

1. Add strict drop verification per mined block family.
2. Add tool durability-aware auto-equip policy.
3. Add inventory-full recovery behavior.
4. Add action reason-code taxonomy.
5. Add deterministic regression for stone/ore harvest correctness.
6. Add LLM-output validation for impossible actions.
7. Add safe replan when 2 consecutive action fails occur.
8. Add emergency safe-mode toggle command.
9. Add action trace IDs in logs.
10. Add death-event handler with auto waypoint tag.

Priority P1:

1. Add furnace orchestration skill.
2. Add chest deposit/withdraw skill.
3. Add base blueprint schema v1.
4. Add structure placement validator.
5. Add shelter-before-night policy.
6. Add return-to-home when risk threshold exceeded.
7. Add exploration radius scheduler.
8. Add hazard heatmap memory.
9. Add mission queue persistence.
10. Add run replay exporter.

Priority P2:

1. Add combat micro policy for melee hostiles.
2. Add ranged threat evasive behavior.
3. Add crop lifecycle automation.
4. Add renewable fuel strategy.
5. Add diamond mining stage policy.
6. Add nether prep checklist executor.
7. Add post-run reflection summarizer.
8. Add benchmark diff report.
9. Add policy auto-tuning assistant.
10. Add long-run anomaly detector.

---

## 11) Command UX Roadmap

Planned owner commands:

1. `!alex objective` -> current stage/subgoal.
2. `!alex plan` -> next 3 actions with rationale.
3. `!alex risk` -> threat and survival posture.
4. `!alex inventory` -> key resource deficits/surpluses.
5. `!alex base` -> base health + pending maintenance.
6. `!alex recover` -> explicit recovery routine.
7. `!alex benchmark start` -> controlled eval run.
8. `!alex policy <profile>` -> safe/aggressive/builder/explorer.

---

## 12) Definition of “Autonomy Done” (Stretch)

Agent is considered “high-autonomy survival-ready” when:

1. It survives 6+ hours on median test seeds.
2. It reaches at least stable iron + functional base consistently.
3. It recovers from at least one major setback per run.
4. It remains controllable and transparent via chat commands.
5. It maintains acceptable API cost envelope for long sessions.

---

## 13) Immediate Next Sprint (Recommended)

Sprint goal: “No fake success, safer progression, better self-correction.”

Commitments:

1. [x] Finish mining postcondition matrix for core resources (stone/deepslate, coal variants, iron variants, logs).
2. [x] Add explicit action result schema with reason codes in logs.
3. [x] Add inventory-full and missing-tool recovery routines.
4. [x] Add night shelter routine with light placement.
5. [x] Add deterministic scenario tests for survival-critical loops.

Exit criteria:

1. Resource harvesting has near-zero false positive success.
2. Agent can self-correct from missing-tool states.
3. Night survival failure rate materially reduced.

---

## 14) Personality System Vision (Autonomy Multiplier)

Purpose:

1. Let one core agent support multiple long-term survival archetypes.
2. Change behavior style without forking the entire codebase.
3. Keep safety guarantees constant while strategic preferences vary.

Non-negotiable constraints:

1. Personality must never disable hard safety policy.
2. Personality must not bypass postcondition validation.
3. Personality may bias choices, not invent impossible actions.

Value:

1. Better replayability and user control.
2. Easier benchmarking across behavior profiles.
3. Better debugging because policy preferences are explicit.

---

## 15) Personality Runtime Model

Core objects:

1. `persona_manifest`:
   - Name, mission statement, bias weights, allowed tactics, forbidden tactics.
2. `persona_policy`:
   - Runtime cache of thresholds and preference weights.
3. `persona_memory`:
   - Profile-specific memory slots (for example: preferred base depth).
4. `persona_state`:
   - Current subphase, confidence, active doctrine, escalation level.

Decision layering:

1. Safety governor:
   - Always highest priority.
2. Mission stage logic:
   - Decides strategic target family.
3. Persona policy:
   - Chooses style-specific option among valid candidates.
4. Tactical planner:
   - Produces action sequence with strict validators.

Switch behavior:

1. Manual switch by owner command.
2. Optional auto-switch based on scenario tags.
3. Switch always performs state handoff and checkpoint.

State handoff requirements:

1. Persist mission queue.
2. Persist base/waypoint graph.
3. Persist outstanding risk alerts.
4. Reset only style-local transient counters.

---

## 16) Persona Catalog v1

`cave_dweller`:

1. Mines aggressively, hides underground, builds subterranean base.
2. Uses short surface windows and minimizes exposure.
3. Prioritizes ore, tunnel safety, and underground logistics.

`homesteader`:

1. Builds surface settlement and farm-first economy.
2. Prefers defense-by-lighting and stable food loops.
3. Expands base modules before deep exploration.

`ranger`:

1. Exploration heavy, many waypoints, lightweight camps.
2. Focuses on map knowledge and resource hotspot routing.
3. Accepts moderate travel risk with strict retreat rules.

`fortress_builder`:

1. Heavy building focus and defensive engineering.
2. High block stockpiles and structured expansion plans.
3. Lower exploration appetite until defense thresholds are met.

`minimalist_speedrun`:

1. Fast progression bias, lower construction overhead.
2. High objective pressure with tight risk budgets.
3. Mostly for benchmark and stress testing, not default play.

---

## 17) Cave Dweller Personality Specification (Detailed)

Identity:

1. Motto: "Depth is safety; surface is a temporary resource zone."
2. Core strategy: establish underground operations early, then scale mining economy.
3. Target outcome: resilient underground base with controlled surface access.

Strategic priorities:

1. P1: secure underground shelter with sealed entry and emergency exit.
2. P2: stabilize food/fuel/light pipeline for cave life.
3. P3: create branch-mining network with wayfinding.
4. P4: progress tool/armor tiers through ore throughput.
5. P5: expand logistics (storage, smelting, backup corridors).

Environmental doctrine:

1. Prefer y-level bands suitable for ore and safety.
2. Avoid open-sky linger except planned resource runs.
3. Avoid night surface activity unless survival-critical.
4. Tag dangerous cave nodes and avoid until gear threshold met.

Base doctrine:

1. Main chamber underground near safe tunnel hub.
2. One concealed surface entrance with controllable door/trapdoor.
3. One emergency escape shaft to alternate surface point.
4. Internal zoning:
   - storage hall
   - smelting hall
   - crafting/tool station
   - sleeping niche
   - farm module
5. Redundant torch and fallback supplies in each zone.

Surface doctrine:

1. Surface visits are mission-scoped and time-bounded.
2. Mandatory return trigger:
   - health drop
   - hostile cluster
   - inventory thresholds reached
   - night proximity
3. Bring-list for each surface run:
   - food reserve
   - torches
   - blocks
   - tool redundancy

Mining doctrine:

1. Maintain branch-mine template with regular spacing.
2. Place interval lighting and hazard markers.
3. Avoid lava/water hazard zones above risk threshold.
4. Maintain "return breadcrumbs" if tunnel topology is complex.

Combat doctrine:

1. Avoid open engagement unless favorable.
2. In caves prioritize choke-point and retreat tactics.
3. Creeper and skeleton encounters trigger stricter retreat rules.
4. Fight only when escape path is known and clear.

Inventory doctrine:

1. Keep cave-ready kit minimum at all times.
2. Reserve blocks for emergency sealing and bridging.
3. Keep tool backups for pickaxe and weapon.
4. Offload to base storage before risky expansion.

Stock targets (initial):

1. Torches: min 32, target 96.
2. Food units: min 20, target 48.
3. Cobblestone/deepslate: min 64, target 256.
4. Coal/charcoal: min 32, target 128.
5. Pickaxes:
   - min 2 usable
   - target 1 active + 2 backups.

Navigation doctrine:

1. Mandatory waypoints:
   - `home_core`
   - `surface_entry_main`
   - `surface_entry_backup`
   - `mine_branch_alpha`
   - `mine_branch_beta`
2. Waypoint confidence decays if path repeatedly fails.
3. Automatically propose reroute when confidence is low.

Cave Dweller mission graph:

1. Stage CD-0: establish temporary underground shelter.
2. Stage CD-1: secure lighting, food, and smelting.
3. Stage CD-2: establish structured mining branches.
4. Stage CD-3: stabilize iron gear and shielded corridors.
5. Stage CD-4: automate replenishment loops and expand.

Stage gates:

1. CD-0 -> CD-1:
   - has enclosed shelter
   - has bed or safe wait protocol
   - has stable torch supply.
2. CD-1 -> CD-2:
   - has crafting + furnace zone
   - has food reserve threshold
   - has stone-tier or better toolchain.
3. CD-2 -> CD-3:
   - has branch network and hazard markers
   - has consistent ore collection
   - has secure return route.
4. CD-3 -> CD-4:
   - has iron-tier baseline kit
   - has redundant access routes
   - has logistics overflow handling.

Failure playbooks:

1. Lost underground:
   - stop expansion
   - place breadcrumb markers
   - path to nearest known safe waypoint.
2. Tool collapse:
   - retreat to base
   - craft backup toolchain
   - suspend high-risk mining.
3. Repeated hostile interruptions:
   - seal section
   - shift to alternate branch
   - schedule controlled clear operation later.
4. Death:
   - immediate bootstrap gear
   - recover at death waypoint if risk budget allows
   - otherwise rebuild core kit first.

---

## 18) Personality Configuration Schema

Target config extension:

```json
{
  "autonomy": {
    "enabled": true,
    "goalMode": "auto",
    "personality": {
      "active": "cave_dweller",
      "allowHotSwap": true
    }
  },
  "personalities": {
    "cave_dweller": {
      "surfaceRiskTolerance": 0.2,
      "maxSurfaceMinutesPerTrip": 6,
      "undergroundBaseDepthTarget": 24,
      "hostileAvoidanceWeight": 0.9,
      "explorationWeight": 0.25,
      "buildingWeight": 0.6,
      "minTorchReserve": 32,
      "minFoodReserve": 20,
      "preferredMission": "underground_progression"
    }
  }
}
```

Manifest structure:

1. Identity fields:
   - `name`, `description`, `tags`.
2. Bias weights:
   - `risk`, `exploration`, `building`, `combat`, `resource_focus`.
3. Policy thresholds:
   - reserves, retreat triggers, night behavior, path risk budget.
4. Allowed/forbidden action families.
5. Stage graph reference and default stage.

---

## 19) Personality-Aware Prompting Contract

Planner input additions:

1. `personality.active`
2. `personality.currentStage`
3. `personality.policySnapshot`
4. `personality.forbiddenActions`
5. `personality.styleDirectives`

Planner output additions:

1. `personaReasoning`
2. `stageTransitionProposal`
3. `riskJustification`

Guardrails:

1. Reject action proposals violating personality hard constraints.
2. Reject stage transitions without gate conditions met.
3. Fall back to deterministic policy when planner output conflicts.

---

## 20) Personality Command UX

New command plan:

1. `!alex persona` -> show active personality + stage.
2. `!alex persona list` -> show installed personalities.
3. `!alex persona set cave_dweller` -> switch persona.
4. `!alex persona stage` -> show stage and gates.
5. `!alex persona policy` -> show key threshold snapshot.
6. `!alex persona lock` -> prevent auto-switch.
7. `!alex persona unlock` -> allow auto-switch.

Chat transparency messages:

1. Announce persona switch and why.
2. Announce stage transition and gate evidence.
3. Announce persona-driven risk decisions.

---

## 21) Personality Evaluation Framework

Per-personality scorecards:

1. Survival duration.
2. Persona consistency score.
3. Objective completion rate by stage.
4. Resource efficiency per hour.
5. Recovery quality after disruptions.

Cave Dweller-specific KPIs:

1. Surface exposure minutes per hour.
2. Underground uptime ratio.
3. Base hardening index.
4. Tunnel safety compliance rate.
5. Ore throughput normalized by risk incidents.

Consistency checks:

1. Personality choice explanation matches observed actions.
2. Forbidden-action rate near zero.
3. Stage progression follows configured graph.

---

## 22) Expanded Testing Matrix for Personalities

Scenario families:

1. Fresh seed bootstrap.
2. Nightfall stress near spawn.
3. Cave hostile ambush.
4. Tool depletion chain.
5. Inventory overflow under ore-rich conditions.
6. Death and recovery under each personality.

Cave Dweller mandatory tests:

1. "Surface temptation":
   - abundant visible surface resources.
   - expected behavior: short harvest, quick underground return.
2. "Tunnel threat":
   - repeated hostile spawn in branch mine.
   - expected behavior: fallback branch and corridor sealing.
3. "Logistics stress":
   - storage saturation + fuel shortage.
   - expected behavior: reprioritize smelting and storage expansion.
4. "Exit failure":
   - blocked primary surface exit.
   - expected behavior: use backup exit protocol.

Regression gates:

1. No personality merge without passing base suite.
2. No personality policy change without consistency diff report.
3. No command UX change without interruption-resume tests.

---

## 23) Autonomy Intelligence Upgrades (Deep)

Planned model evolution:

1. Current:
   - rule-heavy policy + tactical planner.
2. Mid:
   - HTN-like mission decomposition with explicit pre/postconditions.
3. Long:
   - world-model-assisted planning with uncertainty handling.

Core autonomy capabilities to add:

1. Goal arbitration under conflicting objectives.
2. Counterfactual safety checks before risky actions.
3. Temporal planning with day/night horizon.
4. Dynamic replanning after unexpected world changes.
5. Multi-step resource dependency solving.

Data structures:

1. `mission_graph`
2. `resource_dependency_graph`
3. `threat_heatmap`
4. `path_reliability_map`
5. `base_component_registry`

---

## 24) Build System and Blueprint Roadmap (for Survival Bases)

Blueprint layers:

1. Macro layout:
   - room topology and corridor graph.
2. Structural primitives:
   - walls, floors, ceilings, doors, ladders.
3. Functional modules:
   - furnace bank, storage wall, farm cell, safe room.
4. Defensive modules:
   - choke corridors, fallback gates, perimeter lighting.

Cave Dweller blueprint pack v1:

1. Module CD-A:
   - entry tunnel with hidden door.
2. Module CD-B:
   - starter chamber with bed and crafting corner.
3. Module CD-C:
   - smelting/storage room.
4. Module CD-D:
   - branch mine control point.
5. Module CD-E:
   - emergency retreat shaft.

Build quality checks:

1. Structural completeness.
2. Spawn-proof lighting coverage.
3. Path connectivity between critical modules.
4. Recovery accessibility after partial damage.

---

## 25) Cost and Throughput Management Plan

Cost controls:

1. Adaptive planning interval based on risk and novelty.
2. Local deterministic policy first, LLM escalation second.
3. Planner context compaction with memory summaries.
4. Request budget envelopes by run stage.

Expensive-mode capabilities:

1. Reflection calls after major failures.
2. Multi-candidate plan generation and ranking.
3. Nightly policy analysis over replay corpus.

Budget dashboards:

1. Cost per survival hour.
2. Cost per stage transition.
3. Cost per recovered failure.

---

## 26) Team Topology for the Big Program

Suggested team split:

1. Runtime/Gameplay Team:
   - action correctness, building, combat, pathing.
2. Planner/Policy Team:
   - mission logic, persona engine, prompt contracts.
3. Reliability/Eval Team:
   - test harness, metrics, replay and regression gates.
4. Platform/Tools Team:
   - telemetry, dashboards, run orchestration.

Operating cadence:

1. Weekly reliability review.
2. Biweekly persona review.
3. Monthly milestone gate with benchmark report.

---

## 27) 90-Day Detailed Execution Plan (Autonomy + Cave Dweller)

Days 1-30:

1. Implement persona manifest loader and runtime selector.
2. Add `cave_dweller` personality config and command UX.
3. Add cave-dweller stage graph and gate logic.
4. Add persona telemetry fields and scorecards.
5. Add first cave-specific scenario suite.

Days 31-60:

1. Implement underground base blueprint v1 modules.
2. Add tunnel safety protocol and hazard marker logic.
3. Add surface trip scheduler with strict return triggers.
4. Add backup exit strategy and blocked-route recovery.
5. Add persona consistency validator in CI.

Days 61-90:

1. Optimize ore throughput and logistics loops.
2. Add robust death recovery for cave routes.
3. Add long soak tests with cave persona.
4. Tune policy thresholds from replay analysis.
5. Publish v1 cave-dweller benchmark report.

90-day exit targets:

1. Cave Dweller can run 2+ hours median with consistent style.
2. Underground base established in majority of runs.
3. Persona consistency score above predefined threshold.

---

## 28) Long-Term Personality Expansion

Future personalities:

1. `nether_nomad`
2. `fortified_engineer`
3. `village_guardian`
4. `deep_explorer`
5. `resource_tycoon`

Expansion principles:

1. Shared safety core.
2. Shared skill catalog.
3. Personality-specific policy + stage graph only.
4. Mandatory benchmark suite per new persona.

---

## 29) Updated Definition of Done (Autonomy + Personality)

Program-level done criteria:

1. At least three personalities are production-stable.
2. Each personality achieves style-consistent 4+ hour runs.
3. Agent can switch personalities safely at runtime.
4. Failures are explainable with actionable diagnostics.
5. Cost envelope remains within predefined budget targets.

---

## 30) Immediate Next Sprint Addendum (Personality Kickoff)

Add to next sprint:

1. [x] Add `personality.active` to config and runtime state.
2. [x] Add `!alex persona` command family.
3. [x] Implement `cave_dweller` stage CD-0 to CD-2 (extended further to CD-3 baseline).
4. [x] Add cave-only risk policy (night surface avoidance, torch reserve bias, underground threat retreat).
5. [x] Add persona telemetry fields in logs for active persona, stage, and policy hash.
6. [ ] Add persona consistency flags.

Sprint exit criteria:

1. Persona can be switched and persisted.
2. Cave Dweller behavior is visibly distinct from default auto mode.
3. No safety regressions from persona integration.
