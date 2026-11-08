# Writing & Documentation Style Guide

Write for makers, musicians, and developers who want immediate clarity. State what something does, how to trigger it, or what went wrong. Stop writing when the facts run out.

## 1. Global Anti-LLM Rules (Apply Everywhere)

- **No Em Dashes or Mid-Sentence Pivot Dashes:** Never use em dashes (`—`), en dashes (`–`), or spaced hyphens (` - `) to tack on explanations, asides, or dramatic summaries. Do not replace an em dash with a semicolon or colon to preserve a bloated sentence. Instead:
  1. End the sentence with a period. Delete the second clause if it is filler, or start a new sentence if it contains a necessary fact.
  2. Use parentheses `()` strictly for brief technical specs, units, or keyboard shortcuts, such as `(48 kHz, 16-bit)` or `(Shift + Click)`.
  - **Allowed:** en dashes in ranges (`P00–P09`, `0–11`, `C–B`), arrows for mappings and fader travel (`→`, `←→`), and a colon after a label in lists or section headers (`Harmony: slow chord progression`). The ban targets dashes in running prose.
- **Banned Vocabulary:** Never use brochure words: *seamless, seamlessly, robust, powerful, comprehensive, streamline, leverage, utilize, delve, crucial, enhance, elevate, out-of-the-box, intuitive, effortlessly, exciting, thrilled, tailored, empowers.* Use plain verbs ("use", not "utilize"; "fix", not "address an issue where").
- **No Dangling "-ing" Justifications:** Never end a factual sentence with a participial phrase explaining why the feature is good (for example: *"...ensuring smooth transfers," "...enabling faster workflows," "...providing full control,"* or *"...making it easy to..."*). Cut the sentence at the comma.
- **No Negative Parallelisms:** Never write *"It's not just X, it's Y"* or *"Rather than doing X, TouchSpore does Y."* State what the firmware does directly.
- **No Throat-Clearing or Wrap-Ups:** Never open a section, modal, or changelog with a general preamble, and never end with a summary paragraph repeating what was just explained.
- **Concrete Mechanisms Over Metaphors:** Never say data is "wired through," errors "surface" or "bubble up," or processes "spin up." Name the exact action, format, or hardware state.

## 2. Rules by Surface

### A. Control Reference, LED Codes & Simulator Output
TouchSpore has no screen. Its "UI copy" is the README controls table, the LED blink and freeze codes, and text printed by `tools/sim.cpp`.
- **Length Cap:** Controls-table cells max 15 words. Move longer explanations into a short paragraph below the table (2 to 3 sentences).
- **No Self-Reference:** Never start a description with *"This knob allows you to..."* or *"Here you can..."*. Start with the effect: *"Reverb amount and size"* or *"Hold 1.5 s to recalibrate."*
- **Actionable Errors:** For LED error codes and freezes, state: `[What failed] + [How to fix it]`. Never apologize.
  - *Bad:* "Something went wrong with the touch chip, so the controls may not be as responsive as expected."
  - *Good:* "2 blinks: main loop stuck on the touch chip (I2C). Check the MPR121 connection and power-cycle."

### B. Changelogs & News Updates
- **Lead with the User Change:** Start every item with what changed for the user, not internal code refactoring.
- **No Hype Adjectives:** Never announce features as *"We are excited to introduce a powerful new..."*. Use direct verbs: **Added**, **Fixed**, **Changed**, **Removed**.
- **Format:** `[Verb] [Feature/Component]: [What it does now and any constraint].`
  - *Bad:* "Enhanced the touch experience with a comprehensive new sensitivity engine, making it effortless to play with wires."
  - *Good:* "Added flicker events above 50 % on the right fader. Recalibrate after attaching clips."
- Commit messages follow the same rules.

### C. READMEs & Code Documentation
- **Zero Setup Fluff:** Start READMEs with a 1-sentence plain description of the tool, followed immediately by prerequisites, commands, or hardware constraints.
- **Don't Narrate Signatures:** In C++ comments, never repeat what the function name and types already state. Document only register-level quirks (such as MPR121 registers that can only be written in Stop mode), audio-callback timing and real-time constraints, side effects, units and ranges, and why a non-obvious workaround exists.
- **Keep Comments True:** When behaviour changes (a switch is reassigned, a mode is fixed), update or delete the comments that describe the old behaviour.