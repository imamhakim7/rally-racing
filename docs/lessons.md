# Lessons

Engineering lessons that changed a rule in this repo. Keep them short and tie
each one to the ticket that paid for it.

## L1 — Prove a driving-AI change over a seed range, not a seed list (#APEX-27, #APEX-31)

The first ribbon-containment fix shipped with an eight-seed regression test. QA
then found `coastal-cliffs` seed 6186 still off the road; a later revision passed
all eight named seeds and leaked on 3112/6103/9483. CPU behaviour is chaotic in
the seed, so a fix is only proven by a sweep.

**Rule:** any change to the driver, the racing line or the surface coupling must
pass `bun scripts/qa-apex7-verify.ts` (10k seeds × every stage) before review.
`tests/ai-race-edge.test.ts` keeps a stratified 618-race sweep in the normal
suite. A named seed list is a supplement, never the gate.

## L2 — Containment and car-to-car spacing can conflict (#APEX-27, #APEX-32)

Making the pack yield harder (only the car behind brakes; wider block/avoid
bands; blending an away-steer in at close range) measured *worse* for containment
— 56 leaks and 605 window violations over 1800 races — and did not fix spacing
either (26 → 39 races under 2 m).

**Rule:** the ribbon is the hard constraint. Never trade a stage contract for
closer racing. Tune pack spacing with the same sweep as containment and the
finish window (L3), and keep the pre-existing gap visible on its own ticket
(#APEX-32) while it is fixed.

## L3 — Open a gap at the aim point, not with more steer or brake (#APEX-31)

Cars glued together in a bend cannot be separated from the command side. An
added away-steer saturates against the corner demand, and braking both cars (or
only the rear one) keeps them side by side: they slow together and stay 1.9 m
apart. Widening the emergency band on its own *did* recover the gap but cost the
finish window — `emergencyLateral: 3.0` gave 1574 window violations over 1800
races — and `emergencyLateral: 2.5` leaked 144 times. What works is a temporary
lateral shift of the pure-pursuit **aim point** away from the other car (≤1.6 m,
activation band 3.5 m), clamped so `edgeGuardBand` always remains between the
aim and the ribbon edge, with the emergency brake band at 2.52 m.

**Rule:** when the controller cannot satisfy a lateral constraint with steer or
brake, move the point it is pursuing. Never tune one of containment / finish
window / separation alone — measure all three over the same seed sweep, because
each knob trades directly against the other two.
