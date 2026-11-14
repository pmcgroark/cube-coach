/* Cube Coach — teaching content (CC.Lessons).
 *
 * Content only: stages, algorithms, notation primer, narrated demos, a 12-week
 * curriculum, milestones, speed tips and a glossary. Nothing here touches the
 * DOM, and CC.Cube is only looked up inside the helper functions at call time.
 *
 * Every factual claim about moves in this file is checked by simulation in
 * tests/lessons.test.js (rep counts, where to hold each shape, what each
 * algorithm preserves, every demo, every move sequence mentioned in prose).
 *
 * The method: beginner layer-by-layer, daisy variant, solved with YELLOW ON TOP
 * the whole way (white ends up on the bottom).
 *
 * DEMOS use the learning frame: a SOLVED cube held yellow-up / green-front,
 * i.e. CC.Cube.applyAlg(CC.Cube.solved(), 'z2'). In that frame orange is on the
 * right, red on the left and blue at the back. `setup` is face moves only.
 * `moves` is the demonstrated human solution and may include y rotations.
 * narration[i].at is an index into CC.Cube.parseAlg(moves): the text belongs to
 * the moment just BEFORE that move plays (at === moves.length is the closing
 * remark, shown after the last move). Optional checkpoints use the same index
 * and are "pause and predict" questions for the watch screen:
 *   kind 'next' — options are move sequences; options[answer] is what comes next
 *   kind 'reps' — how many times algId is repeated starting at `at`
 *   kind 'alg'  — which algorithm starts at `at` (answerAlg = its id)
 */
(function (root) {
  'use strict';

  var STAGE_IDS = ['daisy', 'cross', 'corners', 'middle', 'ycross', 'yedges', 'ycorners', 'yorient'];

  var LEARNING_FRAME = {
    prefix: 'z2',
    holding: 'Yellow on top, green in front',
    colours: { U: 'Y', D: 'W', F: 'G', B: 'B', R: 'O', L: 'R' }
  };

  // ------------------------------------------------------------------ algorithms
  var ALGORITHMS = {
    rtrigger: {
      id: 'rtrigger',
      name: 'Right trigger',
      notation: "R U R' U'",
      plain: [
        'Right side: turn UP, away from you',
        'Top layer: turn so the front moves to the LEFT',
        'Right side: turn DOWN, toward you',
        'Top layer: turn so the front moves to the RIGHT'
      ],
      mnemonic: 'Up, push, down, pull.',
      summary: 'Swaps the corner in the front-right bottom slot with the corner above it, twisting them a little each time. Repeat it until the white corner is home.',
      usedIn: ['corners'],
      fingerTricks: "Left hand holds the cube still, thumb on the front. R: roll your right wrist up. U: push the top layer's front-right edge to the left with your right index finger. R': roll the wrist back down. U': flick the top's front-left edge to the right with your left index finger. Aim for one smooth rhythm, not four separate moves.",
      reps: [
        { caseId: 'corner-white-right', when: 'Corner above its slot at front-right, white facing right', count: 1 },
        { caseId: 'corner-white-up', when: 'Corner above its slot at front-right, white facing up', count: 3 },
        { caseId: 'corner-white-front', when: 'Corner above its slot at front-right, white facing you', count: 5 },
        { caseId: 'corner-twisted-right', when: 'Corner already in its slot but twisted, white facing right', count: 2 },
        { caseId: 'corner-twisted-front', when: 'Corner already in its slot but twisted, white facing you', count: 4 }
      ],
      fact: 'Do it six times in a row and the cube returns exactly to where it started. That makes it a perfect warm-up: six goes, check nothing changed.',
      order: 6
    },
    'mid-right': {
      id: 'mid-right',
      name: 'Middle edge: right',
      notation: "U R U' R' U' F' U F",
      plain: [
        'Top layer: turn so the front moves to the LEFT',
        'Right side: turn UP, away from you',
        'Top layer: turn so the front moves to the RIGHT',
        'Right side: turn DOWN, toward you',
        'Top layer: turn so the front moves to the RIGHT',
        'Front face: turn anticlockwise (top goes left)',
        'Top layer: turn so the front moves to the LEFT',
        'Front face: turn clockwise (top goes right)'
      ],
      mnemonic: "Away · right-hand part (R U' R') · back · front part (F' U F).",
      summary: 'Drops the edge at the top-front into the front-right slot, when the edge makes an upside-down T at the front and its top colour matches the right centre.',
      usedIn: ['middle'],
      fingerTricks: "Do U R U' R' as one smooth phrase: right index finger for U, right wrist for R and R', left index finger for U'. Then U' again, and F' U F: turn the front with whichever hand feels natural at first.",
      fact: 'The first U moves the edge AWAY from its slot to make room. Think "away, then in".'
    },
    'mid-left': {
      id: 'mid-left',
      name: 'Middle edge: left',
      notation: "U' L' U L U F U' F'",
      plain: [
        'Top layer: turn so the front moves to the RIGHT',
        'Left side: turn UP, away from you',
        'Top layer: turn so the front moves to the LEFT',
        'Left side: turn DOWN, toward you',
        'Top layer: turn so the front moves to the LEFT',
        'Front face: turn clockwise (top goes right)',
        'Top layer: turn so the front moves to the RIGHT',
        'Front face: turn anticlockwise (top goes left)'
      ],
      mnemonic: "The mirror of the right one: away · left-hand part (L' U L) · back · front part (F U' F').",
      summary: 'Drops the edge at the top-front into the front-left slot, when the edge makes an upside-down T at the front and its top colour matches the left centre.',
      usedIn: ['middle'],
      fingerTricks: "Mirror your right hand: the left hand does U' L' U L. Then U, and F U' F' to finish.",
      fact: 'Swap R for L and reverse the direction of every turn, and the right algorithm becomes the left one.'
    },
    ycross: {
      id: 'ycross',
      name: 'Yellow cross',
      notation: "F R U R' U' F'",
      plain: [
        'Front face: turn clockwise (top goes right)',
        'Right side: turn UP, away from you',
        'Top layer: turn so the front moves to the LEFT',
        'Right side: turn DOWN, toward you',
        'Top layer: turn so the front moves to the RIGHT',
        'Front face: turn anticlockwise (top goes left)'
      ],
      mnemonic: "F, trigger, F': turn the front clockwise, do R U R' U', turn the front back.",
      summary: 'Flips top edges so yellow faces up: dot → L, L (held at back-left) → line, line (held left-to-right) → cross.',
      usedIn: ['ycross'],
      fingerTricks: "F: turn the front face clockwise with your right hand (regrip first if you need to). The middle is the right trigger you already know. F' undoes the first move.",
      fact: 'It has the right trigger hidden inside it. Six in a row returns the cube to where it started.',
      order: 6
    },
    sune: {
      id: 'sune',
      name: 'Sune',
      notation: "R U R' U R U2 R'",
      asUsed: "R U R' U R U2 R' U",
      plain: [
        'Right side: turn UP, away from you',
        'Top layer: turn so the front moves to the LEFT',
        'Right side: turn DOWN, toward you',
        'Top layer: turn so the front moves to the LEFT',
        'Right side: turn UP, away from you',
        'Top layer: turn it twice (a half turn, 180°) — either direction',
        'Right side: turn DOWN, toward you'
      ],
      mnemonic: 'Up, push, down, push; up, push-push, down — then one more U.',
      summary: 'Used here as Sune + U: with two matched yellow edges held at the back and right, it swaps the front and left edges so all four match.',
      usedIn: ['yedges'],
      fingerTricks: "Right hand only for R and R'; your right index finger pushes every U (twice in a row for U2). Keep your left hand still.",
      fact: 'Sune followed by U puts the first two layers and the yellow cross back exactly as they were, and leaves the back and right edges where they are. Sune on its own, six times in a row, returns the cube to where it started.',
      order: 6
    },
    'corner-cycle': {
      id: 'corner-cycle',
      name: 'Corner cycle',
      notation: "U R U' L' U R' U' L",
      plain: [
        'Top layer: turn so the front moves to the LEFT',
        'Right side: turn UP, away from you',
        'Top layer: turn so the front moves to the RIGHT',
        'Left side: turn UP, away from you',
        'Top layer: turn so the front moves to the LEFT',
        'Right side: turn DOWN, toward you',
        'Top layer: turn so the front moves to the RIGHT',
        'Left side: turn DOWN, toward you'
      ],
      mnemonic: "The top swings left, right, left, right. In the first half both sides go UP (R, then L'); in the second half both go DOWN (R', then L).",
      summary: 'Leaves the front-right top corner exactly where it is and swaps the other three top corners round in a cycle: front-left → back-right → back-left → front-left.',
      usedIn: ['ycorners'],
      fingerTricks: 'Hold the sides with both hands. The top turns come from your index fingers; the right and left hands take turns.',
      fact: 'Three times in a row returns the cube to where it started — so you never need it more than twice.',
      order: 3
    },
    twist: {
      id: 'twist',
      name: 'Corner twist',
      notation: "R' D' R D",
      plain: [
        'Right side: turn DOWN, toward you',
        'Bottom layer: turn so the front moves to the LEFT',
        'Right side: turn UP, away from you',
        'Bottom layer: turn so the front moves to the RIGHT'
      ],
      mnemonic: 'Down, left, up, right — always in pairs.',
      summary: 'Twists the top-front-right corner a third of a turn every two goes. It scrambles the bottom layers on the way, and they come back once every top corner shows yellow.',
      usedIn: ['yorient'],
      fingerTricks: "Left hand holds the cube still. Right wrist: R' turns the right side down, R turns it back up. For the bottom layer, push its front edge to the LEFT for D' (right ring finger) and to the RIGHT for D (left ring finger, or regrip). Go slowly at first: a wrong D is the usual mistake.",
      reps: [
        { caseId: 'yellow-right', when: 'Yellow facing right', count: 2 },
        { caseId: 'yellow-front', when: 'Yellow facing you', count: 4 }
      ],
      fact: 'Two goes twist the corner a third of a turn, four goes two thirds, and six goes put the whole cube back where it started. That is why the answer is always 2 or 4.',
      order: 6
    }
  };

  // ------------------------------------------------------------------ stages
  var STAGES = {
    daisy: {
      id: 'daisy',
      index: 0,
      title: 'The Daisy',
      tagline: 'Four white petals around the yellow centre.',
      goal: 'Bring all four white edges up around the yellow centre, white stickers facing up.',
      why: 'The daisy is a stepping stone to the white cross. Building it on top, where you can see everything, is far easier than building the cross underneath. Nothing is solved yet, so the only thing you can break is a petal you have already placed.',
      howTo: [
        'Hold the cube with the YELLOW centre on top and keep it there for the whole solve. White (opposite yellow) stays on the bottom; you never need to flip the cube over.',
        'Find a white edge: a two-sticker piece with one white sticker. Bring it up next to the yellow centre with white facing up. That is a petal.',
        'Before lifting an edge, look at the top spot it will land in. If a petal is already there, turn the top (U) first so that spot is empty.',
        'Edge in the middle layer: turn the face its coloured (non-white) sticker is on, in the direction that raises the edge. White lands on top. Turned the wrong way? The edge goes down instead; turn it back and go the other way.',
        'Edge in the bottom layer, white facing down: turn that side twice (a half turn). Edge in the top or bottom layer with white facing sideways: one turn of the face the white is on moves it into the middle layer; then lift it as above.'
      ],
      recognise: [
        { caseId: 'bottom-white-down', name: 'Bottom layer, white facing down', look: 'A white edge sticker on the bottom face.', action: 'Turn the top until the spot directly above is empty, then turn that side twice.' },
        { caseId: 'middle', name: 'Middle layer', look: 'A white edge between two side centres.', action: 'Find the face its coloured (non-white) sticker is on. Make sure the top spot of that face is empty, then turn that face once so the edge rises.' },
        { caseId: 'top-flipped', name: 'Top layer, white facing outwards', look: 'A white sticker in the middle of a side face, top row.', action: 'Turn that side once to drop the edge into the middle layer, then lift it.' },
        { caseId: 'bottom-white-side', name: 'Bottom layer, white facing sideways', look: 'A white sticker in the middle of a side face, bottom row.', action: 'Turn that side once to bring the edge into the middle layer, lift it, then put back any petal you moved.' },
        { caseId: 'daisy-blocked', name: 'Landing spot taken', look: 'The top spot an edge would rise into already holds a petal.', action: "Turn the top (U, U' or U2) until that spot is empty, then lift." }
      ],
      algorithms: [],
      mnemonics: [
        'Petals go white-side up.',
        'Look before you lift: is the landing spot free?',
        'Middle edge? Turn the face with the coloured sticker.'
      ],
      mistakes: [
        'Lifting an edge into a spot that already has a petal: the petal drops off. Check first, then turn the top to make room.',
        'Turning the cube upside down to look underneath and losing track of which way is up. Tilt to peek, then go back to yellow on top.',
        'Mixing up white edges and white corners. Petals are edges: two stickers, middle of a side.',
        "Worrying about the petals' other colours. They don't matter until the next stage."
      ],
      hints: [
        'Look for edges with a white sticker. Each one needs to sit next to the yellow centre with white facing up.',
        'Bottom edge with white facing down: free the top spot above it, then turn that side twice. Middle-layer edge: turn the face its coloured sticker is on, once, so it rises.',
        "Middle-layer edge at front-left with its coloured sticker facing you: F. At front-right: F'. Edge under the front with white facing down: F2. Each time the top-front spot must be empty first."
      ],
      speedTips: [
        'Plan your first two petals before you start turning.',
        'Make room with U turns rather than turning the whole cube.',
        'Once the cross is easy, skip the daisy and build the cross straight onto the bottom (week 9).'
      ]
    },

    cross: {
      id: 'cross',
      index: 1,
      title: 'White Cross',
      tagline: 'Drop each petal to the bottom, matched to its centre.',
      goal: 'Four white edges on the bottom, each side colour matching the centre above it.',
      why: "The cross fixes the white face's four edges and lines them up with the side centres: the frame everything else is built on. Turning the top never touches the bottom layer, so edges you've dropped stay put while you line up the rest.",
      howTo: [
        'Start from the daisy. Each petal has a second colour on its side.',
        "Turn the top (U) until one petal's side colour matches the centre directly below it. You'll see a two-sticker stripe of one colour.",
        'Turn that side twice (a half turn). The edge swings down to the bottom with white facing down, matched.',
        'Repeat for the other three. Many beginners find it easier to always work at the front: turn the cube (y) so the next centre faces you, line its petal up with U, then F2.',
        "Check: tilt the cube. There's a white cross on the bottom, and the bottom-middle sticker of every side matches its centre."
      ],
      recognise: [
        { caseId: 'petal', name: 'Petal matches', look: "The petal's side sticker is the same colour as the centre below it.", action: 'Half turn that side (for example F2).' },
        { caseId: 'cross-top-white-up', name: "Petal doesn't match", look: 'The side sticker is a different colour from the centre below.', action: 'Turn the top until it matches. Never drop an unmatched petal.' }
      ],
      algorithms: [],
      mnemonics: [
        'Match, then drop.',
        'Stripe means ready: same colour on the petal side and the centre, then turn twice.'
      ],
      mistakes: [
        "Dropping a petal that doesn't match its centre. The cross looks right from below but the sides are wrong, and nothing after it will work.",
        'Turning a side once instead of twice: the edge ends up in the middle layer.',
        'Turning a middle slice instead of the top when lining up. Only the top layer turns; the centres stay put.'
      ],
      hints: [
        'Each petal has a second colour. It needs to end up under the centre of that colour.',
        "Turn the top until a petal's side colour matches the centre below it, then turn that side twice.",
        'Petal above a matching centre at the front: F2. On the right: R2. At the back: B2. On the left: L2.'
      ],
      speedTips: [
        'Before turning the top, check whether a petal already matches.',
        'Use R2, B2 and L2 instead of rotating the cube for each petal.',
        'Next step up: build the cross straight onto the bottom without the daisy. It saves moves and a whole pass round the cube.'
      ]
    },

    corners: {
      id: 'corners',
      index: 2,
      title: 'White Corners',
      tagline: 'Finish the white layer with one simple trigger.',
      goal: 'Put the four white corners in place so the whole bottom layer is solved.',
      why: "This completes the first layer: the white face plus the bottom row of every side. The trigger R U R' U' only moves pieces in the right side and the top layer. It lifts the white edge on the right for a moment but always puts it straight back, so the cross survives every repetition.",
      howTo: [
        'A white corner has three stickers: white plus two others. It belongs in the bottom layer, between the two centres of its other colours.',
        'Find a white corner in the top layer. Turn the top (U) until it sits directly above its slot, between the two matching centres.',
        'Turn the whole cube (y) so that slot is at the front-right, under your right hand.',
        "Repeat R U R' U' until the corner drops in with white on the bottom. Where the white sticker faces tells you how many goes: white facing right = 1, white facing up = 3, white facing you = 5.",
        "Stuck corner: a white corner in the bottom layer but in the wrong slot. Hold that slot at front-right and do R U R' U' once: the corner pops up to the top. Then place it as normal. If a corner is in its own slot but twisted, just keep repeating R U R' U' (white facing right: 2 goes, white facing you: 4)."
      ],
      recognise: [
        { caseId: 'corner-white-right', name: 'White facing right', look: 'Corner above its slot at front-right, white sticker on the right face.', action: "R U R' U' once." },
        { caseId: 'corner-white-up', name: 'White facing up', look: 'Corner above its slot at front-right, white sticker on top.', action: "R U R' U' three times." },
        { caseId: 'corner-white-front', name: 'White facing you', look: 'Corner above its slot at front-right, white sticker on the front face.', action: "R U R' U' five times." },
        { caseId: 'corner-stuck', name: 'Stuck in the wrong slot', look: "A white corner in the bottom layer whose side colours don't match the centres next to it.", action: "Hold it at front-right, do R U R' U' once to pop it out, then place it." },
        { caseId: 'corner-twisted', name: 'In its slot but twisted', look: 'A white corner in its own slot (its colours match the centres either side), but white faces sideways.', action: "Hold it at front-right and repeat R U R' U': 2 goes if white faces right, 4 if it faces you." }
      ],
      algorithms: ['rtrigger'],
      mnemonics: [
        "R U R' U': up, push, down, pull.",
        '1-3-5: white right, white up, white facing you.',
        'Park it, point it, pump it: park above the slot, point the slot to front-right, pump the trigger.'
      ],
      mistakes: [
        'Doing the trigger with the corner above the wrong slot. Check that its two side colours match the centres either side of the slot.',
        'Turning the whole cube in the middle of a set of triggers. Finish the count first.',
        "Losing count. Say the numbers out loud. If you lose track, keep going: the corner always drops in within six goes.",
        'Working on a slot at the front-left. Always bring the slot to front-right so the same trigger works every time.'
      ],
      hints: [
        'Find a white corner in the top layer. Which two side colours does it have? Its slot is between those two centres.',
        "Park the corner above its slot, hold that slot at front-right, then R U R' U': white facing right = 1 go, up = 3, facing you = 5.",
        "Corner above the front-right slot, white facing right: R U R' U' once. White up: R U R' U' R U R' U' R U R' U'. White facing you: five goes."
      ],
      speedTips: [
        "White facing right? R U R' is enough: 3 moves.",
        "White facing you? F' U' F does it in 3 moves.",
        "White facing up? R U2 R' U' R U R' takes 7 moves instead of 12.",
        'While your hands do the triggers, let your eyes find the next white corner.'
      ]
    },

    middle: {
      id: 'middle',
      index: 3,
      title: 'Middle Layer',
      tagline: 'Slot the four side edges: right or left.',
      goal: 'Place the four middle-layer edges so the first two layers are complete.',
      why: 'This finishes the first two layers, two-thirds of the cube. Both algorithms take part of the white layer apart and put it back exactly: the first half lifts the white corner out and parks it on top next to the edge, and the second half puts them back into the slot together, as a pair. So the white layer looks broken half-way and is whole again at the end.',
      howTo: [
        'Look in the top layer for an edge with NO yellow. Edges with yellow belong to the last layer, so skip them.',
        "The edge's side sticker tells you which centre to line up with. Turn the top until that sticker sits above the matching centre. You'll see an upside-down T of one colour.",
        "Turn the cube (y) so that centre faces you. Now look at the edge's top colour: it matches either the right centre or the left centre. That's the way it goes.",
        "Goes right: U R U' R' U' F' U F. Goes left: U' L' U L U F U' F'. They are mirror images of each other.",
        "No yellow-free edge on top, but the middle isn't finished? An edge is stuck in a slot (wrong place, or flipped). Hold that slot at front-right, do the right algorithm once to pop it out, then insert it properly.",
        "Learn each algorithm as two halves of four moves. Right: U R U' R' (away, up, back, down), then U' F' U F (aside, open, back, close).",
        "Left is the mirror of right: swap R for L and turn every move the other way. U' L' U L, then U F U' F'. Same rhythm, other hand, so there is really only one thing to remember.",
        'Check yourself after the first half: the edge is back on top at the front, and the white corner sits right next to it with its white sticker facing out to the side (right for the right algorithm, left for the left one). The white layer has a gap there: that is normal.',
        "Lost your place? Don't turn the whole cube in the middle of an algorithm. If you know where you are, just finish it. If not, undo the moves you made in reverse order, each one turned the other way, until the edge is back in the T, then start again from the first move."
      ],
      recognise: [
        { caseId: 'edge-right', name: 'Goes right', look: "Upside-down T at the front; the edge's top colour matches the RIGHT centre.", action: "U R U' R' U' F' U F" },
        { caseId: 'edge-left', name: 'Goes left', look: "Upside-down T at the front; the edge's top colour matches the LEFT centre.", action: "U' L' U L U F U' F'" },
        { caseId: 'edge-stuck', name: 'Stuck in a slot', look: 'A middle edge in the wrong slot or flipped, and no yellow-free edge on top.', action: 'Hold it at front-right, do the right algorithm once, then insert it as normal.' },
        { caseId: 'edge-yellow', name: 'Has yellow', look: 'A top-layer edge with a yellow sticker.', action: 'Skip it: it belongs to the last layer.' }
      ],
      algorithms: ['mid-right', 'mid-left'],
      mnemonics: [
        'Make the T, then follow the top colour.',
        "Right: away (U), right-hand part (R U' R'), back (U'), front part (F' U F).",
        'Left is the mirror: swap R for L and reverse every turn.',
        'Two halves, one rhythm: away, up, back, down; then aside, open, back, close.',
        'First half takes the corner out; second half puts the pair in.'
      ],
      mistakes: [
        'Inserting an edge that has yellow on it. Check both stickers.',
        'Starting the algorithm before making the upside-down T. Line the side colour up with its centre first.',
        "Choosing the wrong side. Look at the edge's TOP colour and find that centre: right or left?",
        'Mixing the two algorithms half-way through. Say "right" or "left" out loud before you start.',
        'Turning the whole cube in the middle of the algorithm. Keep the T at the front until all eight moves are done.',
        'Stopping half-way because the white layer looks broken. It always looks broken in the middle; finish the eight moves and it comes back.',
        "A slip, like R instead of R'. Undo it straight away (turn it back) and carry on. If you just keep going it won't come out right.",
        'Popping out a stuck edge from the wrong place. The right algorithm only changes the front-right slot, so turn the cube until the stuck edge is there first.',
        'Lining up an edge with yellow on top. It can look like a T, but yellow matches neither side centre: skip it.'
      ],
      halves: [
        { algId: 'mid-right', first: "U R U' R'", second: "U' F' U F", rhythm: ['away, up, back, down', 'aside, open, back, close'],
          firstDoes: 'Takes the white corner out of its slot and parks it on top, right next to the edge.',
          secondDoes: 'Puts the corner and the edge back into the slot together.' },
        { algId: 'mid-left', first: "U' L' U L", second: "U F U' F'", rhythm: ['away, up, back, down', 'aside, open, back, close'],
          firstDoes: 'Takes the white corner out of its slot and parks it on top, right next to the edge.',
          secondDoes: 'Puts the corner and the edge back into the slot together.' }
      ],
      mirrorRule: 'Left is the mirror of right: swap R for L, and turn every move the other way (U becomes U\', F\' becomes F).',
      whyItWorks: 'The first half takes the white corner out of its slot and parks it on top, right next to the edge, with matching colours touching. The second half puts the corner and the edge back into the slot together, as a pair. Everything else in the first two layers ends up exactly where it was.',
      landmarks: [
        'After the first half: the edge is back at the front where it started, and the white corner sits on top right next to it, white sticker facing out to the side. The only piece missing from the white layer is that corner: normal.',
        'After all eight moves: the edge is in its slot, the white layer is whole again, and middle edges you placed before are still there.',
        'From the 2nd move to the 7th the white layer always looks broken (after the F turn even the white cross has a piece out). Keep going.'
      ],
      lostPlace: [
        "Don't turn the whole cube in the middle of an algorithm: keep the T at the front.",
        'If you know where you are, finish the algorithm. The checkpoint helps: if the edge and the white corner sit side by side on top at the front and the only piece missing from the white layer is that corner, the first half is done.',
        'If you are not sure, undo the moves you made in reverse order, each one turned the other way, until the edge is back in the T. Then start again from the first move.',
        'The white layer looking broken in the middle of the algorithm is normal. It only matters if it is still broken after the eighth move.',
        'Totally lost? On the virtual cube ask for a hint; with a real cube, rescan it. The coach can find the way back from any position.'
      ],
      hints: [
        'Find a top-layer edge without yellow. Its two colours tell you which slot it belongs in.',
        'Line its side colour up with the matching centre (upside-down T) and face that centre. Top colour matches the right centre: right algorithm. Left centre: left algorithm.',
        "Goes right: U R U' R' U' F' U F. Goes left: U' L' U L U F U' F'."
      ],
      speedTips: [
        'Use U turns to line edges up and only rotate the cube when you have to.',
        'The first U of each algorithm moves the edge AWAY from its slot. Think "away, then in".',
        'Speed comes from never pausing between the two halves of the algorithm.',
        'Later on (F2L): speedsolvers pair each corner with its middle edge and insert both at once, skipping the separate corner stage.'
      ]
    },

    ycross: {
      id: 'ycross',
      index: 4,
      title: 'Yellow Cross',
      tagline: 'One algorithm, up to three times.',
      goal: "Make a yellow cross on top (edges only; corners don't matter yet).",
      why: "This flips the four top edges so yellow faces up. F R U R' U' F' only rearranges the top layer: the first two layers come back exactly as they were.",
      howTo: [
        'Look only at the four top EDGES and the yellow centre; ignore the corners. You will see a dot (no yellow edges), an L, a line, or the cross.',
        "L: turn the top so the L sits at the back-left (yellow edges at the back and left), then F R U R' U' F'. You get a line.",
        "Line: turn the top so it runs left to right, then F R U R' U' F'. You get the cross.",
        'Dot: do the algorithm once from any angle and you get an L. Then carry on as above.'
      ],
      recognise: [
        { caseId: 'dot', name: 'Dot', look: 'Only the yellow centre; no top edge shows yellow.', action: "F R U R' U' F' from any angle, then treat the L." },
        { caseId: 'l-shape', name: 'L-shape', look: 'Two neighbouring top edges show yellow.', action: "Hold the L at the back-left, then F R U R' U' F'." },
        { caseId: 'line', name: 'Line', look: 'Two opposite top edges show yellow.', action: "Hold the line left to right, then F R U R' U' F'." },
        { caseId: 'ycross-done', name: 'Cross', look: 'All four top edges show yellow.', action: 'Nothing to do: next stage.' }
      ],
      algorithms: ['ycross'],
      mnemonics: [
        "F, trigger, F': front clockwise, R U R' U', front back.",
        'Dot → L → line → cross.',
        "L at the back-left; line like the horizon."
      ],
      mistakes: [
        "Holding the L in the wrong corner: it stays an L, or turns into a line running front to back.",
        'Holding the line front to back: it turns back into a dot.',
        'Counting yellow corners. Only the edges matter here.',
        "Forgetting the final F'."
      ],
      hints: [
        'Ignore the corners. Look at the four top edges: dot, L, line or cross?',
        "L at the back-left, or line left to right, then F R U R' U' F'. Dot: do it once from anywhere.",
        "Line left to right: F R U R' U' F' once. L at the back-left: twice. Dot: once, then turn the top so the L is at the back-left, then twice more."
      ],
      speedTips: [
        "For the L, hold it at the back-left and use F U R U' R' F' instead: it goes straight to the cross.",
        'Position the shape with U turns, not by rotating the cube.',
        'Learn the three shapes by sight so you never stop to think.'
      ]
    },

    yedges: {
      id: 'yedges',
      index: 5,
      title: 'Yellow Edges',
      tagline: 'Match the yellow cross to the side colours.',
      goal: "Make each yellow edge's side colour match the centre below it.",
      why: 'This puts the top edges in their places. Sune followed by U keeps the first two layers and the yellow cross; it swaps the front and left top edges and leaves the back and right ones where they are.',
      howTo: [
        "Turn the top until at least two edges match the centres below them. There is always a way to get two.",
        "All four match? Done. Two side by side? Turn the cube (y) so the matched pair is at the BACK and RIGHT, then R U R' U R U2 R' U. All four will match.",
        "Two opposite each other (front and back, or left and right)? Do R U R' U R U2 R' U from where you are, then turn the top to find a side-by-side pair and finish as above."
      ],
      recognise: [
        { caseId: 'edges-aligned', name: 'All four match', look: 'After a turn of the top every edge matches its centre.', action: 'Nothing to do: next stage.' },
        { caseId: 'edges-adjacent', name: 'Neighbouring pair', look: 'Two edges next to each other match their centres.', action: "Pair at the back and right, then R U R' U R U2 R' U." },
        { caseId: 'edges-opposite', name: 'Opposite pair', look: 'Two edges opposite each other match; no turn of the top does better.', action: "R U R' U R U2 R' U once, then look again for a neighbouring pair." }
      ],
      algorithms: ['sune'],
      mnemonics: [
        'Sune: up, push, down, push; up, push-push, down, then U.',
        'Matched pair at the back and right.',
        "R U R' U · R U2 R' · U"
      ],
      mistakes: [
        'Holding the matched pair at the front: the algorithm moves the front edge.',
        'Forgetting the final U.',
        'Deciding the case after one look. Try all four turns of the top before choosing.',
        'Worrying that the corners got mixed up. They are fixed in the next two stages.'
      ],
      hints: [
        'Turn the top until two of the yellow edges match their side centres.',
        "Neighbouring pair: hold it at the back and right, then R U R' U R U2 R' U. Opposite pair: do it once anyway, then look again.",
        "Matched pair at back and right: R U R' U R U2 R' U."
      ],
      speedTips: [
        'Read the side colours of the cross before turning the top; with practice you will see which turn gives the pair.',
        'Later, PLL algorithms place the top edges and corners together in one step.'
      ]
    },

    ycorners: {
      id: 'ycorners',
      index: 6,
      title: 'Yellow Corners: Position',
      tagline: 'Send every top corner home; twists come later.',
      goal: 'Move every top corner to its correct spot (it may still be twisted).',
      why: "This puts the corners in their places. U R U' L' U R' U' L keeps the first two layers and every top edge, leaves the front-right top corner exactly where it is, and swaps the other three round in a cycle.",
      howTo: [
        "A corner is home when its three colours match the three centres around it, even if its yellow isn't on top.",
        "Find a home corner and turn the cube (y) so it is at the front-right of the top layer.",
        "Do U R U' L' U R' U' L. Check: all home? If not, do it once more. It is never needed more than twice.",
        'No corner home? Do the algorithm once from any angle. Afterwards exactly one corner is home.'
      ],
      recognise: [
        { caseId: 'corners-one', name: 'One corner home', look: 'Exactly one top corner matches the three centres around it.', action: "Hold it at front-right, then U R U' L' U R' U' L (once or twice)." },
        { caseId: 'corners-none', name: 'No corner home', look: 'No top corner matches its three centres.', action: "U R U' L' U R' U' L once from anywhere, then find the home corner." },
        { caseId: 'ycorners-all', name: 'All home', look: 'Every top corner matches its three centres (twists allowed).', action: 'Nothing to do: next stage.' }
      ],
      algorithms: ['corner-cycle'],
      mnemonics: [
        'The top swings left, right, left, right.',
        "First half both sides go UP (R, L'); second half both go DOWN (R', L).",
        'Home corner sits at front-right and watches the others go round.'
      ],
      mistakes: [
        'Judging "home" by the yellow sticker. Check the three colours against the three centres.',
        'Holding the home corner anywhere other than front-right of the top.',
        'Rotating the cube between the two goes. The home corner is still at front-right; keep the cube still.'
      ],
      hints: [
        'Look for a corner whose three colours match the three centres around it.',
        "Hold a home corner at front-right of the top, then U R U' L' U R' U' L, once or twice.",
        "Home corner at front-right: U R U' L' U R' U' L, then again if the others aren't home yet."
      ],
      speedTips: [
        'Check all four corners in one look before you rotate.',
        'Later, 2-look PLL places the top corners and edges with faster algorithms.'
      ]
    },

    yorient: {
      id: 'yorient',
      index: 7,
      title: 'Yellow Corners: Twist',
      tagline: 'Twist each corner yellow-up and trust the process.',
      goal: 'Twist each top corner so yellow faces up. The cube is solved.',
      why: "R' D' R D, done in pairs, twists the corner at the top-front-right. Apart from that corner, everything it disturbs is in the bottom two layers, and when every top corner shows yellow those layers come back by themselves, as long as you only turned the top between corners.",
      howTo: [
        'Hold the cube so a twisted corner (yellow facing sideways) is at the front-right of the top. From now until the end, do NOT turn the whole cube.',
        "Repeat R' D' R D until that corner's yellow faces up: yellow facing right = 2 goes, yellow facing you = 4 goes.",
        'The bottom layers will look scrambled. That is normal; keep going.',
        'Turn only the top (U) to bring the next twisted corner to the front-right, and repeat.',
        'When every corner shows yellow on top, turn the top to line it up. Solved.'
      ],
      recognise: [
        { caseId: 'yellow-right', name: 'Yellow facing right', look: 'Twisted corner at top-front-right, yellow on the right face.', action: "R' D' R D twice." },
        { caseId: 'yellow-front', name: 'Yellow facing you', look: 'Twisted corner at top-front-right, yellow on the front face.', action: "R' D' R D four times." },
        { caseId: 'twist-next', name: 'Next corner', look: 'The front-right corner is yellow-up but others are not.', action: 'Turn only the top (U) to bring the next twisted corner to the front-right.' },
        { caseId: 'top-aligned', name: 'All yellow on top', look: 'Every top corner shows yellow; the top layer is out of line.', action: 'Turn the top until the sides line up.' }
      ],
      algorithms: ['twist'],
      mnemonics: [
        "R' D' R D: down, left, up, right.",
        'Always in pairs: 2 or 4.',
        'Never turn the cube, only the top.'
      ],
      mistakes: [
        "Turning the whole cube to reach the next corner: the bottom won't come back by itself. Use U only.",
        "Stopping because the bottom looks broken. Finish every corner and it repairs itself.",
        'Stopping after an odd number of goes. It is always 2 or 4.',
        "Turning the top instead of the bottom inside the algorithm: it's D (bottom), not U."
      ],
      hints: [
        'Hold a twisted corner at the front-right of the top, and do not rotate the cube until the very end.',
        "Repeat R' D' R D: yellow facing right = 2 goes, yellow facing you = 4. Then U to the next twisted corner.",
        "Yellow facing right: R' D' R D R' D' R D. Yellow facing you: R' D' R D four times."
      ],
      speedTips: [
        'Count in pairs, not single goes.',
        'Before starting, look at all four corners so you know how many U turns are coming.',
        'Later, 2-look OLL twists all the corners in one algorithm (Sune is one of them) without disturbing the bottom.'
      ]
    }
  };

  // ------------------------------------------------------------------ notation
  var NOTATION = [
    { id: 'hold', token: '', title: 'How to hold the cube', text: "Yellow centre on top, the face you're working on towards you, thumbs on the front and fingers on the back. Centres never move relative to each other, so yellow stays on top until you deliberately rotate the cube.", tip: 'This method keeps yellow on top for the whole solve. You never need to flip the cube over.' },
    { id: 'faces', token: '', title: 'Six faces, six letters', text: 'U = Up (top), D = Down (bottom), F = Front (towards you), B = Back, R = Right, L = Left. A letter on its own means a quarter turn of that face, clockwise.', tip: 'Letters are positions, not colours: F is whatever is facing you right now.' },
    { id: 'clockwise', token: '', title: 'Clockwise: as if you were looking at that face', text: 'Imagine turning the cube to look straight at the face, then turn it clockwise. That is why R moves the right side UP while L moves the left side DOWN, and why U and D move the front in opposite directions.', tip: 'Seen from the front, R and L (and U and D) turn opposite ways.' },
    { id: 'U', token: 'U', title: 'U: top layer', text: 'Top layer: turn so the front moves to the LEFT.', tip: 'Push the top-front-right edge to the left with your right index finger.' },
    { id: "U'", token: "U'", title: "U': top layer, back the other way", text: 'Top layer: turn so the front moves to the RIGHT.', tip: 'Flick the top-front-left edge to the right with your left index finger.' },
    { id: 'R', token: 'R', title: 'R: right side', text: 'Right side: turn UP, away from you.', tip: 'Your right hand does most of the work in this method. R is a wrist roll upwards.' },
    { id: "R'", token: "R'", title: "R': right side, down", text: 'Right side: turn DOWN, toward you.', tip: 'The exact reverse of R.' },
    { id: 'L', token: 'L', title: 'L: left side', text: 'Left side: turn DOWN, toward you.', tip: 'Opposite to R as you see it: clockwise from the left means the front goes down.' },
    { id: "L'", token: "L'", title: "L': left side, up", text: 'Left side: turn UP, away from you.', tip: "R and L' both move the front of their side upwards." },
    { id: 'F', token: 'F', title: 'F: front face', text: 'Front face: turn clockwise (top goes right).', tip: 'Like turning a steering wheel to the right.' },
    { id: "F'", token: "F'", title: "F': front face, anticlockwise", text: 'Front face: turn anticlockwise (top goes left).', tip: 'Steering wheel to the left.' },
    { id: 'D', token: 'D', title: 'D: bottom layer', text: 'Bottom layer: turn so the front moves to the RIGHT.', tip: 'Opposite to U as you see it from the front.' },
    { id: "D'", token: "D'", title: "D': bottom layer, other way", text: 'Bottom layer: turn so the front moves to the LEFT.', tip: "You'll use D and D' in the very last stage." },
    { id: 'B', token: 'B', title: 'B: back face', text: 'Back face: turn so its top moves to the LEFT (as you look from the front).', tip: 'Clockwise as seen from behind, which looks anticlockwise from the front. You will rarely need it.' },
    { id: "B'", token: "B'", title: "B': back face, other way", text: 'Back face: turn so its top moves to the RIGHT (as you look from the front).', tip: 'Peek round the back if it helps; nobody is timing you yet.' },
    { id: 'prime', token: '', title: "' (prime): the other way", text: "A ' after a letter means anticlockwise: the opposite direction. R' undoes R, U' undoes U.", tip: "Say it as \"R prime\" or \"R inverse\"." },
    { id: 'two', token: 'U2', title: '2: a half turn', text: 'Top layer: turn it twice (a half turn, 180°) — either direction. The same goes for R2, F2 and the rest.', tip: 'Direction does not matter for a half turn; use whichever is comfortable.' },
    { id: 'y', token: 'y', title: 'y: turn the whole cube', text: 'Whole cube: spin it so the RIGHT face comes to the FRONT. Yellow stays on top; only which colour faces you changes.', tip: 'Lower-case x, y, z turn the whole cube, not a layer. Nothing on the cube gets mixed up.' },
    { id: "y'", token: "y'", title: "y': turn the whole cube the other way", text: 'Whole cube: spin it so the LEFT face comes to the FRONT.', tip: 'y2 spins it halfway round, so the back comes to the front.' },
    { id: 'x', token: 'x', title: 'x: tip the whole cube', text: 'Whole cube: turn it the same way as R, so the FRONT face goes to the TOP.', tip: 'You will not need x in this method; it is here so you can read other guides.' },
    { id: 'z', token: 'z', title: 'z: tilt the whole cube', text: 'Whole cube: tilt it clockwise (top goes to the right), the same way as F.', tip: 'z2 turns the cube upside down. That is how the app goes from white-on-top (scanning) to yellow-on-top (solving).' },
    { id: 'cube-vs-face', token: '', title: 'Turn the cube vs turn a face', text: 'Turning a face (U, R, F…) mixes the pieces. Turning the cube (x, y, z) only changes your view: every centre moves with it, so the letters now point at different colours.', tip: 'If you rotate the cube by accident, find yellow and your working colour again before carrying on.' },
    { id: 'reading', token: '', title: 'Reading an algorithm', text: "Read left to right, one move at a time: R U R' U' is R, then U, then R', then U'. Brackets only group moves to make them easier to remember.", tip: 'Learn algorithms in chunks of three or four moves, saying them out loud.' }
  ];

  // ------------------------------------------------------------------ demos
  var DEMOS = {
    daisy: [
      {
        id: 'daisy-down', title: 'White facing down: half turns',
        summary: 'Lift bottom-layer edges with half turns, clearing the landing spot first.',
        caseIds: ['bottom-white-down', 'daisy-blocked'],
        setup: 'F2 U R2',
        moves: 'B2 U L2',
        narration: [
          { at: 0, text: 'Yellow centre on top. Two petals are already in. The white–blue edge is in the bottom layer at the back, white facing down. The top spot above it is empty, so a half turn of the back brings it straight up: B2.' },
          { at: 1, text: 'The white–red edge is under the left side, white facing down. But the top-left spot already holds a petal; lifting now would knock it off. Turn the top (U) to free that spot.' },
          { at: 2, text: 'The top-left spot is empty. L2 lifts the white–red edge.' },
          { at: 3, text: 'Four white petals around the yellow centre: the daisy. Their other colours do not matter yet.' }
        ],
        checkpoints: [
          { at: 1, kind: 'next', prompt: 'The spot above the white–red edge already has a petal. What comes next?', options: ['L2', 'U', 'B2'], answer: 1, explain: 'Turn the top first so the landing spot is empty, then lift.' }
        ]
      },
      {
        id: 'daisy-middle', title: 'Middle-layer edges: one quarter turn',
        summary: 'Lift middle-layer edges by turning the face their coloured sticker is on.',
        caseIds: ['middle', 'bottom-white-down', 'daisy-blocked'],
        setup: "L F R2 D'",
        moves: 'F L U R2',
        narration: [
          { at: 0, text: 'One petal is in (white–orange, top-right). The white–green edge is in the middle layer at front-left: white faces left, green faces you. Turn the face its coloured sticker is on, the front, the way that lifts it: F.' },
          { at: 1, text: 'The white–red edge is in the middle layer at back-left: white faces the back, red faces left. So turn the left side (L): it rises into the empty top-left spot, white up.' },
          { at: 2, text: 'The white–blue edge is under the right side, white facing down. The top-right spot is taken, so turn the top (U) to clear it first.' },
          { at: 3, text: 'R2 lifts it.' },
          { at: 4, text: 'Daisy done. A middle-layer edge needs just one quarter turn; if you turn the wrong way it goes down instead, so turn it back and go the other way.' }
        ],
        checkpoints: [
          { at: 1, kind: 'next', prompt: 'White–red is at back-left in the middle layer, red facing left. Which turn lifts it?', options: ['B', 'L', "L'"], answer: 1, explain: 'Its coloured (red) sticker is on the left face, so the left side turns, the way that raises the edge.' }
        ]
      },
      {
        id: 'daisy-top-out', title: 'White facing outwards in the top layer',
        summary: 'Drop it into the middle layer with one turn, then lift it.',
        caseIds: ['top-flipped', 'middle', 'daisy-blocked'],
        setup: "F' B2 R L2",
        moves: 'R U2 B',
        narration: [
          { at: 0, text: 'Two petals are in (blue at the back, red on the left). The white–green edge is in the top layer on the right, but its white faces outwards, so it is not a petal. Lower down on the right side, the white–orange edge sits in the middle layer at the front, orange facing right. One R turn does two jobs: it lifts white–orange (white up) and drops white–green into the middle layer at the back-right.' },
          { at: 1, text: 'White–green now has green facing the back, so the back face will lift it into the top-back spot. That spot holds the blue petal, so turn the top twice (U2) to free it.' },
          { at: 2, text: 'B lifts white–green, white up.' },
          { at: 3, text: 'Daisy done. White facing outwards in the top layer: turn that side once to drop it into the middle layer, then lift it like any middle edge.' }
        ],
        checkpoints: [
          { at: 1, kind: 'next', prompt: 'The back face will lift white–green into the top-back spot, which holds a petal. What first?', options: ['B', 'U2', "B'"], answer: 1, explain: 'Clear the landing spot with the top layer before lifting.' }
        ]
      },
      {
        id: 'daisy-bottom-side', title: 'White facing sideways in the bottom layer',
        summary: 'Move a petal out of the way, do the job, put it back.',
        caseIds: ['bottom-white-side', 'bottom-white-down'],
        setup: "F R B2 F'",
        moves: "F2 L2 F' R F",
        narration: [
          { at: 0, text: 'One petal (blue, at the back). The white–green edge is under the front, white facing down. The top-front spot holds white–orange, but its white faces you so it is not a petal yet. F2 swaps them: white–green comes up as a petal and white–orange drops to the bottom.' },
          { at: 1, text: 'White–red is under the left side, white facing down, and the top-left spot is free: L2.' },
          { at: 2, text: "Now white–orange: bottom layer, white facing you. F' turns it up into the middle layer at front-right. It also knocks the green petal off the top for a moment; watch it." },
          { at: 3, text: 'Orange faces right, so R lifts white–orange into the top-right spot, white up.' },
          { at: 4, text: 'F puts the green petal straight back.' },
          { at: 5, text: 'Daisy done. "Move something out of the way, do the job, put it back" is the idea behind every algorithm you will learn.' }
        ],
        checkpoints: [
          { at: 4, kind: 'next', prompt: 'White–orange is up, but the green petal was moved off the top. How do you put it back?', options: ["F'", 'F', 'U'], answer: 1, explain: "F undoes the F' from two moves ago, now that the job is done." }
        ]
      }
    ],

    cross: [
      {
        id: 'cross-faces', title: 'Match and drop: half turns',
        summary: 'Turn the top until a petal matches the centre below, then half turn that side.',
        caseIds: ['petal', 'cross-top-white-up'],
        setup: "F2 U R2 U L2 U' B2 U2",
        moves: 'U F2 U R2 B2 U L2',
        narration: [
          { at: 0, text: 'Daisy done. Each petal has a second colour on its side. Turn the top until one matches the centre below it: one U turn brings the white–green petal above the green centre.' },
          { at: 1, text: 'Matched: a green stripe. Turn the front twice (F2). The edge drops to the bottom, white underneath.' },
          { at: 2, text: 'Turn the top again: U brings white–orange above the orange centre on the right.' },
          { at: 3, text: 'R2 drops it. The top can turn freely now: it never touches the bottom.' },
          { at: 4, text: 'Look before turning: white–blue is already above the blue centre at the back. B2.' },
          { at: 5, text: 'Last one: U brings white–red above the red centre on the left.' },
          { at: 6, text: 'L2.' },
          { at: 7, text: 'White cross on the bottom, every edge matching its centre.' }
        ],
        checkpoints: [
          { at: 4, kind: 'next', prompt: 'White–blue is already above the blue centre. Next move?', options: ['U', 'B2', 'R2'], answer: 1, explain: 'It already matches, so drop it straight away.' }
        ]
      },
      {
        id: 'cross-front', title: 'Match and drop: always at the front',
        summary: 'The same idea, turning the cube so you always work on the front.',
        caseIds: ['petal', 'cross-top-white-up'],
        setup: "F2 U R2 U L2 U' B2 U",
        moves: 'U2 F2 y U F2 y F2 y U F2',
        narration: [
          { at: 0, text: 'Same job, done the way many beginners find easiest: always work at the front. Green faces you. Turn the top until the green petal is above the green centre: a half turn (U2).' },
          { at: 1, text: 'F2 drops it.' },
          { at: 2, text: 'Turn the whole cube (y) so orange faces you. Yellow stays on top.' },
          { at: 3, text: 'U brings white–orange to the front, above orange.' },
          { at: 4, text: 'F2.' },
          { at: 5, text: 'Turn the cube again (y): blue faces you.' },
          { at: 6, text: 'White–blue is already above the blue centre, so drop it straight away: F2.' },
          { at: 7, text: 'Last one: y, so red faces you.' },
          { at: 8, text: 'U lines up the red petal.' },
          { at: 9, text: 'F2.' },
          { at: 10, text: 'Cross done.' }
        ],
        checkpoints: [
          { at: 6, kind: 'next', prompt: 'Blue faces you and the blue petal is already above it. Next move?', options: ['U', 'F2', 'y'], answer: 1, explain: 'Matched already, so drop it.' }
        ]
      }
    ],

    corners: [
      {
        id: 'corners-right', title: 'White facing right: one go',
        summary: 'Park the corner above its slot; white facing right means one trigger.',
        caseIds: ['corner-white-right'],
        setup: "F' U' F U2",
        moves: "U' R U R' U'",
        narration: [
          { at: 0, text: 'The cross is done. The white–green–orange corner is in the top layer at front-left. It belongs between the green and orange centres, in the bottom slot at front-right. U\' parks it directly above that slot.' },
          { at: 1, text: "Where does its white sticker face? Right. White right = one go: R U R' U' (up, push, down, pull)." },
          { at: 5, text: 'In, with white on the bottom.' }
        ],
        checkpoints: [
          { at: 1, kind: 'reps', algId: 'rtrigger', prompt: "White faces right. How many times R U R' U'?", options: ['1', '3', '5'], answer: 0, explain: 'White facing right = 1.' }
        ]
      },
      {
        id: 'corners-front', title: 'White facing you: five goes',
        summary: 'Turn the cube so the slot is at front-right, park the corner, count to five.',
        caseIds: ['corner-white-front'],
        setup: "L' U' L U F U F' U' F U F' U2",
        moves: "y' U R U R' U' R U R' U' R U R' U' R U R' U' R U R' U'",
        narration: [
          { at: 0, text: "The white–red–green corner is at the top, but above the wrong slot. It belongs between red and green. Turn the whole cube (y') so red faces you and green is on your right: that slot is now at front-right." },
          { at: 1, text: 'U brings the corner directly above the slot.' },
          { at: 2, text: 'White faces you, so that means five goes. One…' },
          { at: 6, text: 'Two…' },
          { at: 10, text: 'Three… The corner hops between the top and the slot; trust the count.' },
          { at: 14, text: 'Four…' },
          { at: 18, text: 'Five.' },
          { at: 22, text: 'In. Facing you = 5, facing up = 3, facing right = 1.' }
        ],
        checkpoints: [
          { at: 2, kind: 'reps', algId: 'rtrigger', prompt: "White faces you. How many times R U R' U'?", options: ['1', '3', '5'], answer: 2, explain: 'White facing you (front) = 5.' }
        ]
      },
      {
        id: 'corners-up', title: 'White facing up: three goes',
        summary: 'White on top is the middle case: three triggers.',
        caseIds: ['corner-white-up'],
        setup: "R' U' R U B U B' U' B2 U B2 U' B2 U2",
        moves: "y U2 R U R' U' R U R' U' R U R' U'",
        narration: [
          { at: 0, text: 'The white–orange–blue corner is in the top layer with white facing up. It belongs between orange and blue. Turn the cube (y) so orange faces you and blue is on your right.' },
          { at: 1, text: 'A half turn of the top (U2) parks it above that slot, now at front-right.' },
          { at: 2, text: 'White facing up = three goes. One…' },
          { at: 6, text: 'Two…' },
          { at: 10, text: 'Three.' },
          { at: 14, text: 'Done, and the cube never needed flipping.' }
        ],
        checkpoints: [
          { at: 2, kind: 'reps', algId: 'rtrigger', prompt: "White faces up. How many times R U R' U'?", options: ['1', '3', '5'], answer: 1, explain: 'White facing up = 3.' }
        ]
      },
      {
        id: 'corners-stuck', title: 'Stuck corner: pop it out',
        summary: 'A white corner in the wrong bottom slot comes out with one trigger.',
        caseIds: ['corner-stuck', 'corner-white-right'],
        setup: "F' U' F U' F U' F'",
        moves: "y' R U R' U' y U' R U R' U'",
        narration: [
          { at: 0, text: "Stuck case: the white–green–orange corner is in the bottom layer but in the red–green slot (front-left), the wrong place. The white–red–green corner, which belongs in that slot, waits right above it. Turn the cube (y') so that slot is at front-right." },
          { at: 1, text: "One R U R' U' kicks the wrong corner up to the top, and here it also drops white–red–green neatly into place." },
          { at: 5, text: 'Now chase the corner you kicked out. White–green–orange belongs between green and orange: turn the cube back (y) so green faces you.' },
          { at: 6, text: "U' parks it above its slot, white facing right: one go." },
          { at: 11, text: "Both corners home. A corner in its own slot but twisted needs no pop-out: just keep repeating R U R' U' (2 or 4 goes)." }
        ],
        checkpoints: [
          { at: 6, kind: 'next', prompt: 'White–green–orange has been kicked out to the top-front-left. What parks it above its slot?', options: ['U', "U'", 'U2'], answer: 1, explain: "U' moves the front of the top layer to the right, carrying the corner from front-left to front-right." }
        ]
      }
    ],

    middle: [
      {
        id: 'middle-right', title: 'Edge goes right',
        summary: 'Make the upside-down T, read the top colour, use the right algorithm.',
        caseIds: ['edge-right'],
        setup: "F U R U' R' F2 U' F U R U R' U2",
        moves: "U U R U' R' U' F' U F",
        narration: [
          { at: 0, text: 'First layer done. Find a top edge with no yellow: green–orange, on the right of the top layer. Its side sticker is green, so turn the top (U) until it sits above the green centre: an upside-down T.' },
          { at: 1, text: "Its top colour is orange, and orange is the right centre: it goes right. U R U' R' U' F' U F. The first U moves the edge away from its slot…" },
          { at: 2, text: "…R U' R' is the right-hand part…" },
          { at: 5, text: "…U' turns back, and F' U F, the front part, drops the edge in." },
          { at: 9, text: 'Slotted, and the white layer is intact.' }
        ],
        checkpoints: [
          { at: 1, kind: 'alg', answerAlg: 'mid-right', prompt: 'Upside-down T at the front; top colour orange; orange is on the right. Which algorithm?', options: ['Middle edge: right', 'Middle edge: left'], answer: 0, explain: 'The top colour matches the right centre, so it goes right.' }
        ]
      },
      {
        id: 'middle-left', title: 'Edge goes left',
        summary: 'Face the centre that matches the side colour; the top colour says left.',
        caseIds: ['edge-left'],
        setup: "B U L U' L' U B' U' R' U' R U2",
        moves: "y2 U' U' L' U L U F U' F'",
        narration: [
          { at: 0, text: 'The orange–blue edge is in the top layer on the right; its side sticker is blue. Turn the whole cube (y2) so blue faces you.' },
          { at: 1, text: "U' brings the edge round to the front, above the blue centre: upside-down T." },
          { at: 2, text: "Its top colour is orange, and orange is now on the LEFT. Left algorithm: U' L' U L U F U' F'." },
          { at: 10, text: 'Slotted. Left and right are mirror images: swap R for L and reverse every turn.' }
        ],
        checkpoints: [
          { at: 2, kind: 'alg', answerAlg: 'mid-left', prompt: 'Upside-down T at the front; top colour orange; orange is on the left. Which algorithm?', options: ['Middle edge: right', 'Middle edge: left'], answer: 1, explain: 'The top colour matches the left centre, so it goes left.' }
        ]
      },
      {
        id: 'middle-stuck', title: 'Stuck edge: pop it out',
        summary: 'A flipped edge comes out with the right algorithm, then goes back in properly.',
        caseIds: ['edge-stuck', 'edge-right'],
        setup: "R U' R U2 F R2 F' U2 R2",
        moves: "U R U' R' U' F' U F U2 U R U' R' U' F' U F",
        narration: [
          { at: 0, text: 'Stuck: the green–orange edge is in its slot but flipped, green on the right and orange at the front. Every top edge has yellow, so kick it out: with the slot at front-right, do the right algorithm.' },
          { at: 8, text: 'The edge is now in the top layer at the back, green facing the back. U2 brings it to the front, above green: upside-down T, orange on top.' },
          { at: 9, text: 'Orange is the right centre, so the right algorithm again.' },
          { at: 17, text: 'Fixed. An edge in the wrong slot comes out the same way: put that slot at front-right and run the right algorithm once.' }
        ],
        checkpoints: [
          { at: 8, kind: 'next', prompt: 'The edge popped out at the back, green facing the back. What lines it up with the green centre?', options: ['U', "U'", 'U2'], answer: 2, explain: 'A half turn brings the back of the top layer to the front.' }
        ]
      },
      {
        id: 'middle-right-back', title: 'Edge at the back',
        summary: "An edge can start anywhere on top: one U, U' or U2 brings it round to its centre.",
        caseIds: ['edge-right'],
        setup: "F R U R' U' F2 U' F U R U R' U",
        moves: "U2 U R U' R' U' F' U F",
        narration: [
          { at: 0, text: 'The only top edge without yellow is green–orange, at the back: green faces the back and orange is on top. The green centre is in front, so a half turn of the top (U2) brings the edge round above it.' },
          { at: 1, text: "Upside-down T, orange on top, and orange is the right centre: right algorithm. First half, U R U' R': away, up, back, down." },
          { at: 5, text: "Half-way: the edge is back at the front and the white corner sits right next to it on top. Second half, U' F' U F: aside, open, back, close." },
          { at: 9, text: 'Slotted, and the white layer is whole again.' }
        ],
        checkpoints: [
          { at: 0, kind: 'next', prompt: 'Green–orange is on top at the back, green facing the back. Which turn brings it above the green centre?', options: ['U', "U'", 'U2'], answer: 2, explain: 'A half turn brings the back of the top layer round to the front.' },
          { at: 1, kind: 'alg', answerAlg: 'mid-right', prompt: 'Upside-down T at the front, orange on top, and orange is the right centre. Which algorithm?', options: ['Middle edge: right', 'Middle edge: left'], answer: 0, explain: 'The top colour matches the right centre, so it goes right.' }
        ]
      },
      {
        id: 'middle-right-turn', title: 'Not above its own colour',
        summary: 'Line an edge up with the centre of its SIDE colour, not whatever centre it happens to be above.',
        caseIds: ['edge-right'],
        setup: "R B U B' U' R2 U' R U B U B'",
        moves: "y U' U R U' R' U' F' U F",
        narration: [
          { at: 0, text: 'The only top edge without yellow is orange–blue, at the front. It sits above the green centre, but its side sticker is orange, not green, so this is not a T. Turn the whole cube (y) so the orange centre faces you.' },
          { at: 1, text: "Orange faces you now and the edge has moved to the top-left. U' brings it to the front, right above the orange centre: upside-down T." },
          { at: 2, text: 'Its top colour is blue, and blue is now the right centre: right algorithm.' },
          { at: 10, text: 'Slotted between orange and blue. Face the centre of the side colour first, then line the edge up.' }
        ],
        checkpoints: [
          { at: 0, kind: 'next', prompt: 'Orange–blue is at the top front with orange facing you, but the front centre is green. What first?', options: ['y', "U R U' R' U' F' U F", "U' L' U L U F U' F'"], answer: 0, explain: 'Its side colour is orange, so turn the whole cube until orange faces you (y), then line it up.' },
          { at: 2, kind: 'alg', answerAlg: 'mid-right', prompt: 'Orange in front, the T is made, blue on top, and blue is the right centre. Which algorithm?', options: ['Middle edge: right', 'Middle edge: left'], answer: 0, explain: 'The top colour matches the right centre, so it goes right.' }
        ]
      },
      {
        id: 'middle-two', title: 'Two edges in a row',
        summary: 'One edge at a time: insert it, then find the next one.',
        caseIds: ['edge-right', 'edge-left'],
        setup: "L U L' U' B' U' B U' F' U' F U R U R' U2",
        moves: "U U R U' R' U' F' U F y' U2 U' L' U L U F U' F'",
        narration: [
          { at: 0, text: 'Two top edges have no yellow: green–orange on the right and red–blue on the left. Do one at a time. Green–orange first: its side sticker is green, and green is in front, so U brings it round above the green centre.' },
          { at: 1, text: 'Orange on top, and orange is the right centre: right algorithm.' },
          { at: 9, text: "One in. Now red–blue: it has moved to the top-right, red on its side. Turn the cube (y') so the red centre faces you." },
          { at: 10, text: 'The edge is at the back now, red facing the back. U2 brings it to the front, above red.' },
          { at: 11, text: 'Blue on top, and blue is the left centre: left algorithm.' },
          { at: 19, text: 'Two in a row. Each algorithm leaves the edges you have already placed exactly where they were.' }
        ],
        checkpoints: [
          { at: 9, kind: 'next', prompt: 'Green–orange is in. Red–blue is at the top-right, red on its side, and the red centre is on the left. First move?', options: ["y'", 'y', 'U'], answer: 0, explain: "y' spins the cube so the LEFT face (red) comes to the front." },
          { at: 11, kind: 'alg', answerAlg: 'mid-left', prompt: 'Red in front, the T is made, blue on top, and blue is the left centre. Which algorithm?', options: ['Middle edge: right', 'Middle edge: left'], answer: 1, explain: 'The top colour matches the left centre, so it goes left.' }
        ]
      },
      {
        id: 'middle-wrong-slot', title: 'Edge in the wrong slot',
        summary: 'Insert the edge that belongs in that slot: it kicks the wrong one out to the top.',
        caseIds: ['edge-left', 'edge-right'],
        setup: "F' U' F U R U R' U' B U B' U' R' U' R U'",
        moves: "y2 U2 U' L' U L U F U' F' y2 U R U' R' U' F' U F",
        narration: [
          { at: 0, text: 'The green–orange edge is in the wrong slot: it sits at the back-right, between blue and orange. No need to pop it out, because the edge that belongs there, blue–orange, is on top at the front (blue facing you). Insert blue–orange and it will kick green–orange out. Its side colour is blue, so turn the cube (y2) to face blue.' },
          { at: 1, text: 'Blue faces you and the edge is at the back, blue facing the back. U2 brings it round above the blue centre.' },
          { at: 2, text: 'Orange on top, and orange is the left centre: left algorithm. Watch the green–orange edge in that slot.' },
          { at: 10, text: 'Blue–orange is home, and green–orange has been kicked out to the top, at the back with green facing the back. Its side colour is green: turn the cube back (y2) to face green.' },
          { at: 11, text: 'It is already a T: green above green, orange on top. Orange is the right centre: right algorithm.' },
          { at: 19, text: 'Both home. Inserting an edge always pushes out whatever was in that slot.' }
        ],
        checkpoints: [
          { at: 2, kind: 'alg', answerAlg: 'mid-left', prompt: 'Blue in front, the T is made, orange on top, and orange is the left centre. Which algorithm?', options: ['Middle edge: right', 'Middle edge: left'], answer: 1, explain: 'The top colour matches the left centre, so it goes left.' },
          { at: 10, kind: 'next', prompt: 'Blue–orange is home and green–orange was kicked out to the top. What next?', options: ['y2', "U R U' R' U' F' U F", 'U2'], answer: 0, explain: 'Its side colour is green, so turn the cube to face green first.' }
        ]
      },
      {
        id: 'middle-no-edge', title: 'No usable edge on top',
        summary: 'Every top edge has yellow: find the stuck middle edge, bring it to the front-right, pop it out.',
        caseIds: ['edge-stuck', 'edge-right'],
        setup: "B' U' B U L U L' U B' U' B U L U L' U'",
        moves: "y2 U R U' R' U' F' U F U2 U R U' R' U' F' U F",
        narration: [
          { at: 0, text: 'Every top edge has a yellow sticker, so none of them goes in the middle. But the middle layer is not finished, so look around it: at the back-left, the blue–red edge is in its own slot but flipped (blue on the red side). Turn the cube (y2) so that slot is at the front-right.' },
          { at: 1, text: 'Stuck slot at the front-right. Do the right algorithm once, whatever edge is on top: it swaps the stuck edge out to the top.' },
          { at: 9, text: 'Out: blue–red is on top at the back, blue facing the back. U2 brings it round above the blue centre.' },
          { at: 10, text: 'Red on top, and red is the right centre: right algorithm.' },
          { at: 18, text: 'Fixed. No usable edge on top always means a stuck middle edge: find it, hold it at the front-right, pop it out.' }
        ],
        checkpoints: [
          { at: 0, kind: 'next', prompt: 'No top edge is free of yellow, and the blue–red edge at the back-left is flipped. What first?', options: ['y2', "U R U' R' U' F' U F", 'U'], answer: 0, explain: 'Bring the stuck slot to the front-right first (y2), then do the right algorithm.' },
          { at: 9, kind: 'next', prompt: 'It popped out on top at the back, blue facing the back. Which turn lines it up with the blue centre?', options: ['U', "U'", 'U2'], answer: 2, explain: 'A half turn brings the back of the top layer to the front.' }
        ]
      },
      {
        id: 'middle-yellow-trap', title: 'The yellow-edge trap',
        summary: 'A T with yellow on top is not a middle edge: yellow matches neither side centre.',
        caseIds: ['edge-yellow', 'edge-left'],
        setup: "U F R U R' F' U' L' U' L U'",
        moves: "U2 U' L' U L U F U' F'",
        narration: [
          { at: 0, text: 'Careful: the top-front edge shows green above the green centre, which looks like an upside-down T. But its top sticker is YELLOW, and yellow is neither the left nor the right centre: that edge belongs to the top layer, so skip it. The only top edge with no yellow is green–red, at the back. U2 brings it round.' },
          { at: 1, text: 'Now a real T: green above green, red on top. Red is the left centre: left algorithm.' },
          { at: 9, text: 'In. Before you start an algorithm, check both stickers of the edge: an edge with yellow never goes in the middle layer.' }
        ],
        checkpoints: [
          { at: 0, kind: 'next', prompt: 'The top-front edge shows green above the green centre, but its top sticker is yellow. What next?', options: ["U R U' R' U' F' U F", 'U2', "U' L' U L U F U' F'"], answer: 1, explain: 'Skip the yellow edge. Bring the green–red edge (no yellow) round from the back instead.' },
          { at: 1, kind: 'alg', answerAlg: 'mid-left', prompt: 'Green in front, a real T this time, red on top, and red is the left centre. Which algorithm?', options: ['Middle edge: right', 'Middle edge: left'], answer: 1, explain: 'The top colour matches the left centre, so it goes left.' }
        ]
      }
    ],

    ycross: [
      {
        id: 'ycross-line', title: 'Line: hold it left to right',
        summary: 'A line needs one go, held horizontally.',
        caseIds: ['line'],
        setup: "F U R U' R' F' U",
        moves: "U F R U R' U' F'",
        narration: [
          { at: 0, text: 'First two layers done. On top: a yellow line, running front to back. The algorithm needs it left to right, so turn the top (U).' },
          { at: 1, text: "Line left to right. Now F R U R' U' F': front clockwise, the trigger, front anticlockwise." },
          { at: 7, text: 'Yellow cross. Ignore the corners and side colours for now.' }
        ],
        checkpoints: [
          { at: 0, kind: 'next', prompt: 'The line runs front to back. First move?', options: ['U', 'F', 'R'], answer: 0, explain: "Turn the top a quarter turn so the line runs left to right (U' would work too)." }
        ]
      },
      {
        id: 'ycross-l', title: 'L-shape: back-left, two goes',
        summary: 'Hold the L at the back-left: L becomes a line, line becomes a cross.',
        caseIds: ['l-shape', 'line'],
        setup: "U F R U R' U' F' U2",
        moves: "U2 F R U R' U' F' F R U R' U' F'",
        narration: [
          { at: 0, text: 'An L-shape: yellow edges at the front and right. It must sit at the back-left (pointing to 9 and 12 o\'clock): U2.' },
          { at: 1, text: "F R U R' U' F' once…" },
          { at: 7, text: '…turns the L into a line, already left to right. Same algorithm again.' },
          { at: 13, text: 'Cross. L = two goes, line = one go.' }
        ],
        checkpoints: [
          { at: 0, kind: 'next', prompt: 'The L points front and right. How do you get it to the back-left?', options: ['U', 'U2', "U'"], answer: 1, explain: 'A half turn takes front-right to back-left.' }
        ]
      },
      {
        id: 'ycross-dot', title: 'Dot: three goes',
        summary: 'Dot → L → line → cross.',
        caseIds: ['dot', 'l-shape', 'line'],
        setup: "F U R U' R' F' U F R U R' U' F'",
        moves: "F R U R' U' F' U2 F R U R' U' F' F R U R' U' F'",
        narration: [
          { at: 0, text: "No yellow edges on top, only the centre: the dot. Do F R U R' U' F' from any angle." },
          { at: 6, text: 'Now there is an L at the front-right. Turn the top (U2) to put it at the back-left.' },
          { at: 7, text: 'Algorithm again: the L becomes a line…' },
          { at: 13, text: '…and once more: the line becomes the cross.' },
          { at: 19, text: 'Dot, L, line, cross: never more than three goes.' }
        ],
        checkpoints: [
          { at: 6, kind: 'next', prompt: 'An L appeared at the front-right. Next move?', options: ['U', 'U2', "U'"], answer: 1, explain: 'Put the L at the back-left first.' }
        ]
      }
    ],

    yedges: [
      {
        id: 'yedges-adjacent', title: 'Neighbouring pair: back and right',
        summary: 'Find two matching edges side by side, hold them back-right, Sune + U.',
        caseIds: ['edges-adjacent'],
        setup: "U' R U R' U R U2 R' U'",
        moves: "U' y' R U R' U R U2 R' U",
        narration: [
          { at: 0, text: "Yellow cross done, but its side colours don't all match. Turn the top until at least two edges match their centres: U' lines up green (front) and orange (right), side by side." },
          { at: 1, text: "Hold the matched pair at the BACK and RIGHT: turn the cube (y')." },
          { at: 2, text: "R U R' U R U2 R'…" },
          { at: 9, text: '…then the final U.' },
          { at: 10, text: 'All four match. The back and right edges stayed put; the front and left swapped.' }
        ],
        checkpoints: [
          { at: 1, kind: 'next', prompt: 'The matched pair is at the front and right. Where does it need to go, and how?', options: ["y'", 'y', 'U'], answer: 0, explain: "y' brings the left face to the front, so the front-right pair moves to the right and back." }
        ]
      },
      {
        id: 'yedges-opposite', title: 'Opposite pair: once, then again',
        summary: 'An opposite pair turns into a neighbouring pair after one go.',
        caseIds: ['edges-opposite', 'edges-adjacent'],
        setup: "R U R' U R U2 R' U' R U R' U R U2 R'",
        moves: "R U R' U R U2 R' U U y R U R' U R U2 R' U",
        narration: [
          { at: 0, text: "Two edges match, but opposite each other (left and right), and no turn of the top does better. Do the algorithm once from here: R U R' U R U2 R' U." },
          { at: 8, text: 'Now turn the top (U): the back and left edges match, a neighbouring pair.' },
          { at: 9, text: 'Put the pair at the back and right: y.' },
          { at: 10, text: 'Algorithm again.' },
          { at: 18, text: 'All four edges match.' }
        ],
        checkpoints: [
          { at: 9, kind: 'next', prompt: 'The matched pair is at the back and left. How do you get it to the back and right?', options: ['y', "y'", 'U'], answer: 0, explain: 'y brings the right face to the front, so back-left moves to back-right.' }
        ]
      }
    ],

    ycorners: [
      {
        id: 'ycorners-one', title: 'One corner home: hold it front-right',
        summary: 'The home corner stays put while the other three go round.',
        caseIds: ['corners-one'],
        setup: "L' U' L U' L' U' R U' L U R' U' R U R' U R U2 R'",
        moves: "y2 U R U' L' U R' U' L",
        narration: [
          { at: 0, text: 'Yellow edges done. Check each top corner: is it home, ignoring twist? Home means its three colours match the three centres around it. Only the back-left corner (yellow–red–blue) is home. Turn the cube (y2) so it is at front-right.' },
          { at: 1, text: "U R U' L' U R' U' L: the front-right corner stays put and the other three swap round in a cycle." },
          { at: 9, text: 'All four corners are home. Some are twisted: that is the next stage.' }
        ],
        checkpoints: [
          { at: 1, kind: 'alg', answerAlg: 'corner-cycle', prompt: 'Home corner at front-right. Which algorithm?', options: ['Sune', 'Corner cycle', 'Corner twist'], answer: 1, explain: 'The corner cycle leaves front-right alone and moves the other three.' }
        ]
      },
      {
        id: 'ycorners-twice', title: 'Not yet? Do it again',
        summary: 'If one go is not enough, the second always is.',
        caseIds: ['corners-one'],
        setup: "U R U' L' U R' U2 L U' L' U2 L R U R' U R U2 R'",
        moves: "U R U' L' U R' U' L U R U' L' U R' U' L",
        narration: [
          { at: 0, text: 'The front-right corner (yellow–green–orange) is home, even though its yellow faces sideways; the other three are not. It is already at front-right, so start.' },
          { at: 8, text: 'Check again: the three corners moved, but not into their homes yet. Same algorithm once more, without turning the cube.' },
          { at: 16, text: 'All home.' }
        ],
        checkpoints: [
          { at: 8, kind: 'next', prompt: 'Three corners still are not home. What now?', options: ["U R U' L' U R' U' L", "R U R' U R U2 R'", 'y'], answer: 0, explain: 'The home corner is still at front-right, so repeat the corner cycle.' }
        ]
      },
      {
        id: 'ycorners-none', title: 'No corner home',
        summary: 'One go from anywhere makes exactly one corner home.',
        caseIds: ['corners-none', 'corners-one'],
        setup: "R U R' U R U' R' U R U' R' U R U2 R'",
        moves: "U R U' L' U R' U' L y U R U' L' U R' U' L",
        narration: [
          { at: 0, text: 'No corner is home. Do the algorithm once from any angle; afterwards exactly one corner will be home.' },
          { at: 8, text: 'Now the back-right corner (yellow–orange–blue) is home. Turn the cube (y) to bring it to front-right.' },
          { at: 9, text: 'Algorithm again.' },
          { at: 17, text: 'All four in place.' }
        ],
        checkpoints: [
          { at: 8, kind: 'next', prompt: 'The home corner is at the back-right. How do you bring it to front-right?', options: ['y', "y'", 'y2'], answer: 0, explain: 'y brings the right face to the front, so back-right moves to front-right.' }
        ]
      }
    ],

    yorient: [
      {
        id: 'yorient-two', title: 'Two twisted corners: 2 and 4',
        summary: 'Count in pairs, turn only the top, trust the bottom to come back.',
        caseIds: ['yellow-right', 'yellow-front', 'twist-next', 'top-aligned'],
        setup: "L' U' L U' L' U2 L R U R' U R U2 R'",
        moves: "R' D' R D R' D' R D U R' D' R D R' D' R D R' D' R D R' D' R D U'",
        narration: [
          { at: 0, text: "Last stage. Two corners are twisted (yellow facing sideways). One is at front-right with yellow facing right: two goes of R' D' R D. From now on, never turn the whole cube." },
          { at: 4, text: 'Second go.' },
          { at: 8, text: "This corner is yellow-up, but the white layer looks scrambled. Don't panic and don't turn the cube: turn only the top (U) to bring the next twisted corner to front-right." },
          { at: 9, text: 'This one has yellow facing you: four goes. One…' },
          { at: 13, text: 'Two…' },
          { at: 17, text: 'Three…' },
          { at: 21, text: 'Four.' },
          { at: 25, text: "Yellow on top everywhere, and the bottom has repaired itself. U' lines up the top layer." },
          { at: 26, text: 'Solved!' }
        ],
        checkpoints: [
          { at: 0, kind: 'reps', algId: 'twist', prompt: "Yellow faces right. How many times R' D' R D?", options: ['2', '3', '4'], answer: 0, explain: 'Yellow facing right = 2.' },
          { at: 9, kind: 'reps', algId: 'twist', prompt: "Yellow faces you. How many times R' D' R D?", options: ['2', '4', '6'], answer: 1, explain: 'Yellow facing you = 4.' }
        ]
      },
      {
        id: 'yorient-three', title: 'Three twisted corners',
        summary: 'Same routine three times; the top turns, the cube never does.',
        caseIds: ['yellow-right', 'twist-next', 'top-aligned'],
        setup: "F U2 F' U' F U' F' U2 L' U2 L U L' U' L U L' U L",
        moves: "R' D' R D R' D' R D U R' D' R D R' D' R D U2 R' D' R D R' D' R D U",
        narration: [
          { at: 0, text: "Three twisted corners. The one at front-right has yellow facing right: two goes of R' D' R D." },
          { at: 8, text: 'Next twisted corner: U brings it to front-right. Yellow faces right again: two goes.' },
          { at: 17, text: 'U2 brings the last twisted corner round.' },
          { at: 18, text: 'Yellow faces right again: two more goes.' },
          { at: 26, text: 'All yellow on top. U lines up the top layer.' },
          { at: 27, text: 'Solved. Yellow right = 2, yellow facing you = 4.' }
        ],
        checkpoints: [
          { at: 17, kind: 'next', prompt: 'The last twisted corner is at the back-left. Bring it to front-right using only the top:', options: ['U', 'U2', "U'"], answer: 1, explain: 'A half turn of the top takes back-left to front-right.' },
          { at: 18, kind: 'reps', algId: 'twist', prompt: "Yellow faces right. How many times R' D' R D?", options: ['2', '4', '6'], answer: 0, explain: 'Yellow facing right = 2.' }
        ]
      }
    ]
  };

  // ------------------------------------------------------------------ curriculum
  var CURRICULUM = [
    {
      week: 1, title: 'Hold it, name it, build the daisy',
      focus: 'Notation, the daisy and the white cross.',
      goals: ['Name every face turn on sight (U, D, R, L, F, B and their primes).', 'Build the daisy from any scramble without help.', 'Turn a daisy into a matched white cross.'],
      routine: [
        { minutes: 5, activity: 'Notation drill: watch a move, name it.' },
        { minutes: 5, activity: 'Watch the daisy and cross demos; pause at each checkpoint and predict.' },
        { minutes: 10, activity: 'Scramble, daisy, cross. Repeat. Use hints freely.' }
      ],
      target: 'Daisy + cross in under 3 minutes.',
      milestone: 'A white cross on your own from any scramble.'
    },
    {
      week: 2, title: 'The first two layers',
      focus: 'White corners and the middle layer, with the coach showing you.',
      goals: ["Know the 1-3-5 rule for R U R' U' without looking it up.", 'Recognise the upside-down T and choose right or left.', 'Learn both middle-layer algorithms by heart.'],
      routine: [
        { minutes: 5, activity: 'Warm-up: cross from a scramble.' },
        { minutes: 5, activity: 'Watch the corners and middle-layer demos; predict the rep counts.' },
        { minutes: 10, activity: 'Practise corners and middle layer on a scrambled cube (virtual or real) at Show or Coach level.' }
      ],
      target: 'First two layers with guidance.',
      milestone: 'First two layers complete, even if the app showed you every move.'
    },
    {
      week: 3, title: 'The last layer, guided',
      focus: 'Yellow cross, yellow edges, yellow corners: position and twist.',
      goals: ['Recognise dot, L and line, and hold each correctly.', 'Hold matched edges at the back and right.', 'Twist corners without rotating the cube.'],
      routine: [
        { minutes: 5, activity: 'Algorithm recall: say each of the seven algorithms out loud.' },
        { minutes: 5, activity: 'Watch the demos for the four last-layer stages; pause and predict.' },
        { minutes: 10, activity: 'One full guided solve, start to finish.' }
      ],
      target: 'A complete solve with the coach.',
      milestone: 'Your first complete solve (help allowed).',
      milestoneId: 'first-solve'
    },
    {
      week: 4, title: 'Your first solo solve',
      focus: 'Ask for less help; let recognition do the work.',
      goals: ['Drop every stage to Nudge level or below.', 'Use hints only after 30 seconds of being stuck.', 'Finish a solve with zero hints.'],
      routine: [
        { minutes: 5, activity: 'Recognition drill: case → action.' },
        { minutes: 5, activity: 'Reps drill: how many triggers or twists?' },
        { minutes: 10, activity: 'Two solves at Nudge or Solo level.' }
      ],
      target: 'Any time, unaided. Expect 6 to 12 minutes; that is normal.',
      milestone: 'First fully unaided solve on a real cube.',
      milestoneId: 'first-solo'
    },
    {
      week: 5, title: 'Smooth, not fast',
      focus: 'Remove the long pauses between stages.',
      goals: ['Know what comes next at every stage without thinking.', 'Get every stage to Solo level.', 'Time every solve.'],
      routine: [
        { minutes: 5, activity: 'Algorithm drill on the weakest two algorithms.' },
        { minutes: 15, activity: 'Three timed solves; note your slowest stage.' }
      ],
      target: 'Under 5 minutes.',
      milestone: 'A solve under 5 minutes.',
      milestoneId: 'sub-5'
    },
    {
      week: 6, title: 'Recognition speed',
      focus: 'See the case instantly: 1-3-5, dot/L/line, 2 or 4.',
      goals: ['Answer recognition drills in under 2 seconds.', 'Never lose count of repetitions.', 'Find the next corner during each trigger.'],
      routine: [
        { minutes: 5, activity: 'Recognition and reps drills against the clock.' },
        { minutes: 15, activity: 'Timed solves, focusing on your slowest stage.' }
      ],
      target: 'Under 4 minutes most of the time.',
      milestone: 'Average of 5 under 4:00.'
    },
    {
      week: 7, title: 'The sub-3 push',
      focus: "Inspection and the first finger tricks for R U R' U'.",
      goals: ['Plan the daisy during a 15-second inspection.', "Do R U R' U' without regripping.", 'Use the corner shortcuts when white faces right or towards you.'],
      routine: [
        { minutes: 5, activity: 'Trigger practice: six in a row, smooth, several times.' },
        { minutes: 15, activity: 'Timed solves with inspection.' }
      ],
      target: 'Under 3 minutes.',
      milestone: 'Your first solve under 3:00. With this method it is very achievable.',
      milestoneId: 'sub-3'
    },
    {
      week: 8, title: 'Make sub-3 normal',
      focus: 'Consistency: no disasters, no forgotten algorithms.',
      goals: ['Average of 5 under 3:00.', 'No stage needs a hint.', 'Every stage at mastery.'],
      routine: [
        { minutes: 5, activity: 'Due algorithms (spaced repetition).' },
        { minutes: 15, activity: 'Five timed solves; record your average of 5.' }
      ],
      target: 'Average of 5 under 3:00.',
      milestone: 'Sub-3 average: the goal, reached.'
    },
    {
      week: 9, title: 'Cross without the daisy',
      focus: 'Build the white cross directly on the bottom.',
      goals: ['Solve the cross straight onto the bottom.', 'Plan the first two cross edges in inspection.', 'Keep yellow on top while doing it.'],
      routine: [
        { minutes: 10, activity: 'Cross-only practice: scramble, inspect, build the cross on the bottom.' },
        { minutes: 10, activity: 'Timed solves using the new cross.' }
      ],
      target: 'Cross in under 30 seconds.',
      milestone: 'Ten solves in a row without a daisy.'
    },
    {
      week: 10, title: 'Look-ahead and fewer rotations',
      focus: 'Keep the hands moving while the eyes look for the next piece.',
      goals: ['Turn slowly enough that you never stop.', 'Use U turns rather than y rotations wherever you can.', 'Find the next corner or edge during the current algorithm.'],
      routine: [
        { minutes: 5, activity: 'Slow solve: turn at half speed and never pause.' },
        { minutes: 15, activity: 'Timed solves.' }
      ],
      target: 'Under 2 minutes.',
      milestone: 'A solve under 2:00.',
      milestoneId: 'sub-2'
    },
    {
      week: 11, title: 'A look beyond: 2-look last layer',
      focus: 'Optional: one safe shortcut now, and a map of what comes next.',
      goals: ["Use F U R U' R' F' for the L-shape (it goes straight to the cross).", 'Understand how 2-look last layer works: make the whole top yellow first (OLL), then put the pieces in place (PLL).', 'Decide whether to stay with the beginner method or start learning 2-look OLL.'],
      routine: [
        { minutes: 10, activity: 'Drill the L-shape shortcut until it is automatic.' },
        { minutes: 10, activity: 'Timed solves, using the shortcut whenever an L comes up.' }
      ],
      target: 'Under 2 minutes consistently.',
      milestone: 'The L-shape shortcut in your solves, and a plan for what to learn next.'
    },
    {
      week: 12, title: 'Put it all together',
      focus: 'Any cube, any time, under 3 minutes, without help.',
      goals: ['Average of 12 under 2:30.', 'Solve a cube someone else scrambled, unaided.', 'Set your next goal: sub-90 is in reach with F2L.'],
      routine: [
        { minutes: 5, activity: 'Warm-up: algorithms and triggers.' },
        { minutes: 15, activity: 'Twelve timed solves across the week; track your average of 12.' }
      ],
      target: 'Average of 12 under 2:30.',
      milestone: 'Any cube under 3 minutes, without help. Done.'
    }
  ];

  var EXPECTATIONS = 'Honest expectations at 20 minutes a day: first guided solve in week 3, first unaided solve around weeks 3 to 4 (usually 6 to 12 minutes), under 5 minutes by about week 5, under 3 minutes somewhere in weeks 6 to 8. Big drops come from recognising cases instantly and never pausing, not from turning faster. Some weeks will feel flat; that is normal.';

  // ------------------------------------------------------------------ milestones
  var MILESTONES = [
    { id: 'first-solve', name: 'First solve', desc: 'Complete a whole solve, with as much help as you need.' },
    { id: 'first-virtual', name: 'Virtual solver', desc: 'Solve the on-screen cube from a scramble.' },
    { id: 'first-coach', name: 'Training wheels off', desc: 'Complete a solve without any stage at Show level.' },
    { id: 'first-solo', name: 'Solo', desc: 'Solve a real cube with every stage at Solo level and no hints.' },
    { id: 'sub-10', name: 'Under 10 minutes', desc: 'An unaided real-cube solve in under 10:00.' },
    { id: 'sub-5', name: 'Under 5 minutes', desc: 'An unaided real-cube solve in under 5:00.' },
    { id: 'sub-3', name: 'Under 3 minutes', desc: 'An unaided real-cube solve in under 3:00. The goal.' },
    { id: 'sub-2', name: 'Under 2 minutes', desc: 'An unaided real-cube solve in under 2:00.' },
    { id: 'sub-90', name: 'Under 90 seconds', desc: 'An unaided real-cube solve in under 1:30.' },
    { id: 'streak-7', name: 'Week streak', desc: 'Practise seven days in a row.' },
    { id: 'streak-30', name: 'Month streak', desc: 'Practise thirty days in a row.' },
    { id: 'all-mastered', name: 'All stages mastered', desc: 'Every stage mastered (a mastery score of 78 or more).' },
    { id: 'solves-100', name: 'Centurion', desc: 'One hundred completed solves.' }
  ];

  // ------------------------------------------------------------------ tips
  var SPEED_TIPS = [
    { title: 'Inspect before you start', text: 'Take up to 15 seconds to look before turning (competitions allow 15). Find the white edges and plan your first two petals or cross edges.' },
    { title: 'Smooth beats fast', text: 'Pauses cost more than slow turns. Turn at a speed where you never stop to look, and your times will drop.' },
    { title: 'Look ahead', text: "While your hands finish one step, your eyes find the next piece. Start with the corners: during R U R' U' repetitions, find the next white corner." },
    { title: 'Fewer cube rotations', text: 'Every y costs time and makes you find your pieces again. Bring pieces to you with U turns where you can.' },
    { title: 'Shortcut the white corners', text: "Corner above its slot at front-right: white facing right, R U R' (3 moves); white facing you, F' U' F (3 moves); white up, R U2 R' U' R U R' (7 moves instead of 12)." },
    { title: 'Finger tricks for the trigger', text: "Do R U R' U' without letting go: right wrist for R and R', right index finger pushes U, left index finger flicks U'." },
    { title: 'Count twists in pairs', text: "R' D' R D always comes in pairs: 2 or 4. Count pairs, not single goes." },
    { title: 'One-step L for the yellow cross', text: "With the L held at the back-left, F U R U' R' F' goes straight to the cross." },
    { title: 'Cross without the daisy', text: 'Build the white cross straight onto the bottom and plan it during inspection. It saves moves and a whole pass round the cube.' },
    { title: 'Learn algorithms off the cube', text: 'Say them, write them, air-cube them with your hands. The demos and drills in this app work without a cube in your hands.' },
    { title: 'Measure with averages', text: 'Single times are noisy. Track your average of 5 (drop the best and worst, average the middle three) and your average of 12.' },
    { title: 'A good cube helps', text: 'A modern magnetic speed cube turns more easily and catches less than an old stiff cube, which makes finger tricks practical.' },
    { title: 'Little and often', text: 'Twenty minutes a day beats two hours on Sunday. End each session with one timed solve.' },
    { title: 'Next level: 2-look last layer', text: 'After sub-2, learn 2-look OLL (orient the last layer in two steps) and 2-look PLL (permute it in two steps), about 16 algorithms in all. They do the job of the four last-layer stages with one algorithm per step and far fewer moves.' }
  ];

  // No cube to hand? Ways to keep learning from the app alone.
  var NO_CUBE_TIPS = [
    { title: 'Watch, pause, predict', text: 'Play a demo, pause at each checkpoint and say what comes next before you continue. Anticipating is the skill that makes you fast.' },
    { title: 'Half-speed replays', text: 'Replay demos at half speed and watch one piece only: where it starts, where it goes, which move takes it there.' },
    { title: 'Air-cube the algorithms', text: 'Hold an imaginary cube and do each algorithm with your hands while reading the notation. Your fingers learn the rhythm without a cube.' },
    { title: 'Recognition drills', text: 'Case drills show a position and ask for the action: 1-3-5, right or left, dot/L/line, 2 or 4. A few minutes a day builds instant recognition.' },
    { title: 'Solve the virtual cube', text: 'The on-screen cube always knows its state, so the coach can tell you exactly what to do next, and when you have finished a stage.' },
    { title: 'Explain it out loud', text: 'After a demo, explain each step in one sentence, for example "the first U moves the edge away so it can come back in". If you can explain it, you will remember it.' },
    { title: 'Review the algorithms that are due', text: 'The algorithm drill brings back each algorithm just before you are likely to forget it. Do it on the virtual cube or air-cube it, then check.' }
  ];

  var GLOSSARY = [
    { term: 'Centre', text: 'The middle sticker of a face. Centres never move relative to each other, so they tell you which colour each face will be.' },
    { term: 'Edge', text: 'A piece with two stickers, between two centres. There are 12.' },
    { term: 'Corner', text: 'A piece with three stickers. There are 8.' },
    { term: 'Piece vs sticker', text: "A piece is a physical cubelet; a sticker is one of its coloured faces. You move pieces; you read stickers." },
    { term: 'Face', text: 'One of the six sides: U (up), D (down), F (front), B (back), R (right), L (left).' },
    { term: 'Layer', text: 'A slice of the cube, one piece thick, that turns together. With yellow on top there are top, middle and bottom layers.' },
    { term: 'Slot', text: 'A gap a piece belongs in, named by its neighbours: "the green–orange slot" is the bottom corner or middle edge between those two centres.' },
    { term: 'Petal', text: 'A white edge next to the yellow centre with white facing up. Four petals make the daisy.' },
    { term: 'Daisy', text: 'Four white petals around the yellow centre: a stepping stone to the white cross.' },
    { term: 'Cross', text: 'Four edges around a centre, each matching its side colour.' },
    { term: 'Upside-down T', text: "The shape you see on a side face when a middle-layer edge is lined up: the solved bottom row is the bar, and the centre plus the edge's matching sticker above it make the upright." },
    { term: 'Algorithm', text: 'A fixed sequence of moves that does a known job, like moving one piece while putting everything else back.' },
    { term: 'Trigger', text: "A short, fast-to-do sequence that appears inside many algorithms. R U R' U' is the right trigger." },
    { term: 'Case', text: 'A recognisable situation that tells you which algorithm (and how many times) to use.' },
    { term: 'Rep', text: 'One repetition of an algorithm: "white facing up needs three reps".' },
    { term: 'Prime', text: "The ' mark after a letter: turn that face anticlockwise." },
    { term: 'Rotation', text: 'Turning the whole cube (x, y or z) to change your view. No pieces get mixed up.' },
    { term: 'Inspection', text: 'Looking at the cube before you start the timer, to plan your first moves. Competitions allow 15 seconds.' },
    { term: 'Look-ahead', text: 'Finding the next piece while your hands are still finishing the current step, so you never stop.' },
    { term: 'Finger trick', text: 'Doing a move with a flick of one finger instead of a whole-hand turn.' },
    { term: 'Sune', text: "R U R' U R U2 R': a famous last-layer algorithm. Here it places the yellow edges." },
    { term: 'F2L', text: 'First two layers. Speedsolvers solve each corner and its middle edge together.' },
    { term: 'OLL / PLL', text: 'Orient the last layer (make the top all yellow) and permute the last layer (put its pieces in place). 2-look versions split each into two steps.' },
    { term: 'Average of 5 (ao5)', text: 'Five solves, drop the best and worst, average the other three. A fairer measure of your speed than a single time.' }
  ];

  // ------------------------------------------------------------------ helpers
  function stage(id) { return STAGES[id] || null; }
  function algorithm(id) { return ALGORITHMS[id] || null; }

  function findDemo(id) {
    for (var s = 0; s < STAGE_IDS.length; s++) {
      var list = DEMOS[STAGE_IDS[s]] || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    }
    return null;
  }

  // Start/end states of a demo, computed on demand with CC.Cube.
  // -> { stageId, start:[54], moves:[tokens], end:[54], holding }
  function demoStates(demoOrId) {
    var Cube = root.CC && root.CC.Cube;
    if (!Cube) throw new Error('CC.Cube is not loaded');
    var demo = typeof demoOrId === 'string' ? findDemo(demoOrId) : demoOrId;
    if (!demo) throw new Error('Unknown demo: ' + demoOrId);
    var stageId = null;
    STAGE_IDS.forEach(function (sid) { if ((DEMOS[sid] || []).indexOf(demo) !== -1) stageId = sid; });
    var start = Cube.applyAlg(Cube.applyAlg(Cube.solved(), LEARNING_FRAME.prefix), demo.setup);
    var moves = Cube.parseAlg(demo.moves);
    return { stageId: stageId, start: start, moves: moves, end: Cube.applyAlg(start, moves), holding: LEARNING_FRAME.holding };
  }

  var Lessons = {
    STAGE_IDS: STAGE_IDS,
    LEARNING_FRAME: LEARNING_FRAME,
    STAGES: STAGES,
    ALGORITHMS: ALGORITHMS,
    NOTATION: NOTATION,
    DEMOS: DEMOS,
    CURRICULUM: CURRICULUM,
    EXPECTATIONS: EXPECTATIONS,
    MILESTONES: MILESTONES,
    SPEED_TIPS: SPEED_TIPS,
    NO_CUBE_TIPS: NO_CUBE_TIPS,
    GLOSSARY: GLOSSARY,
    stage: stage,
    algorithm: algorithm,
    findDemo: findDemo,
    demoStates: demoStates
  };

  root.CC = root.CC || {};
  root.CC.Lessons = Lessons;
  if (typeof module !== 'undefined' && module.exports) module.exports = Lessons;
})(typeof window !== 'undefined' ? window : globalThis);
