# ✦ The Ward Roster ✦

*The Content-Tag Taxonomy of the Velvet Grimoire*

> *"Name the thing before it is brought into the room. A ward spoken is a ward raised. A ward unspoken is a door left open."*

Companion document to **SAFETY.md** (The Warden's Compact). This roster is the vocabulary the Grimoire uses to describe what a scene contains — so consent can be informed and the engine can refuse scenes that cross a player's permanent line.

---

## I. The Three Families of Ward

Every scene in the Grimoire must carry **at least one ward from each family** before it may be saved:

| Family | What it declares | Stored on scene as |
|---|---|---|
| **Element wards** | *What* is present in the scene | `elementWards: string[]` |
| **Intensity wards** | *How present* — register of narration | `intensityWard: 'suggested' \| 'explicit' \| 'visceral'` |
| **Frame wards** | *How framed* within the fiction | `frameWard: 'consensual-if' \| 'dubcon-if' \| 'noncon-if'` |

The prefix `-if` on frame wards stands for *in-fiction*. The Compact governs real consent; the frame ward only describes the fictional frame.

---

## II. Element Wards — the Canonical Roster

These are the element tags that ship with a new campaign. Campaign owners may add to this roster by mutual consent; names cannot be removed once a scene has used them (to keep historical data interpretable).

### Presence & power
- `intimacy` — sexual or sensual contact, any register
- `nudity` — disrobing, bare bodies, whether or not sexual
- `arousal` — explicit arousal (of any character, any gender)
- `power-exchange` — consensual dominance/submission dynamics
- `dubcon-roleplay` — in-fiction dubious consent as a *consensual* roleplay frame
- `noncon-roleplay` — in-fiction non-consent as a *consensual* roleplay frame
- `humiliation` — degradation, shaming, name-calling
- `praise` — worship, adoration, "good" dynamics
- `voyeurism` — watching, being watched, surveillance as kink
- `exhibition` — public or semi-public scenes

### Body & sensation
- `restraint` — ropes, cuffs, pinning, confinement of movement
- `impact` — striking, spanking, slapping
- `pain` — pain play in any direction
- `blood` — drawn blood on the page
- `wax` — hot wax, heat play
- `edge` — knives, needles, sharps (consensual)
- `breath` — breath play, choking, smothering
- `marking` — bruises, bites, brands, aftermarks

### Threat & narrative
- `violence` — combat, assault, bodily harm, non-sexual
- `weaponry` — weapons drawn or used
- `captivity` — imprisonment, kidnapping, cages
- `interrogation` — coerced questioning
- `surveillance` — being watched without knowledge, bugs, magical scrying
- `pursuit` — being hunted, chased
- `betrayal` — established trust being broken on screen
- `manipulation` — gaslighting, psychological coercion

### Substance & state
- `intoxication` — alcohol, potions, altered states
- `drugs` — recreational or narrative drug use
- `dissociation` — a character leaving their body, depersonalization
- `mind-altering` — magical or technological mind effects

### Body autonomy
- `body-modification` — piercing, branding, transformation
- `transformation` — species, gender, shape shifts
- `possession` — being inhabited by another consciousness
- `body-horror` — visceral physical transformation or violation

### Social & institutional
- `religious-imagery` — sacred spaces, ritual, gods
- `blasphemy` — transgression of the sacred
- `family-dynamics` — on-screen family relationships with charge
- `authority` — clergy, royalty, officers, teachers — power-differential figures
- `financial-coercion` — debt, purchase, ownership tropes

### Dark fantasy staples
- `undeath` — vampires, liches, the returned
- `fey` — bargains with fae, name-magic
- `demon-pact` — infernal contracts
- `horror` — supernatural dread, the uncanny

### Hard-gated (require Compact-level ack)
These element wards require an explicit *yes* from both players at campaign creation. A scene carrying any of these cannot be authored until the protagonist owner has typed the tag name into an acknowledgement field.
- `noncon-roleplay`
- `dubcon-roleplay`
- `captivity`
- `pain`
- `blood`
- `breath`
- `body-horror`
- `humiliation`

---

## III. Intensity Wards — How Present

Exactly one per scene.

| Ward | Meaning | Narration register |
|---|---|---|
| `suggested` | The thing is present in the world but not in the prose. "The door closes. Morning comes." | Camera off. Implication only. Euphemism permitted. |
| `explicit` | The thing is narrated, with specificity, without lingering. Language is direct but measured. | Camera on, medium shot. Names the act, not every beat. |
| `visceral` | Full on-page narration, slow, sensory, body-aware. The prose stays in the room. | Camera in close. Long takes. Every sense engaged. |

**Pacing rules (from the Compact):**
- First session of a new campaign: `suggested` only.
- Any session: at most one `visceral` scene.
- A session should not *end* on a `visceral` scene.
- Two consecutive `visceral` scenes are prohibited — at minimum a `suggested` or narrative-only beat must separate them.

---

## IV. Frame Wards — How the Fiction Frames It

Exactly one per scene. Describes the *in-fiction* relational frame.

| Ward | Meaning |
|---|---|
| `consensual-if` | Characters in fiction have consented to what occurs. Default for most scenes. |
| `dubcon-if` | Characters' consent is ambiguous, impaired, coerced by circumstance, or uneven in fiction. **Requires** element ward `dubcon-roleplay`. |
| `noncon-if` | Characters do not consent in fiction. **Requires** element ward `noncon-roleplay` and the hard-gated acknowledgement. |

> **The Warden's Reminder.** The frame ward names the *fictional* frame only. Real consent between players is governed by the Compact: the Threshold, the Ember, the Banished Names. A scene tagged `noncon-if` is still played under full out-of-game consent; the "noncon" describes what the characters are doing, not what the players are doing.

---

## V. The Banished Names — Per-Protagonist Hard Limits

Banished Names are stored on the **protagonist**, not the campaign. They persist across sessions and scenes for as long as the protagonist is active.

Schema:

```js
protagonist.banishedNames = [
  { tag: "breath",   declaredAt: "2026-04-19T…", note: "personal — not on page" },
  { tag: "captivity", declaredAt: "…", note: "veiled only, never explicit" },
  …
]
```

### Engine enforcement

The admin panel's scene save flow should reject with a red halt:

> **⛔ The Warden Stays Your Hand.** This scene carries the ward `breath`, which is a Banished Name for the protagonist *[name]*. The scene cannot be saved as authored. Remove the ward, or retire the protagonist from this scene.

The refusal is non-dismissable. There is no "save anyway." The only paths are:
1. Remove the offending ward from the scene.
2. Change the scene's protagonist assignment.
3. Retire the Banished Name via a separate, deliberate workflow in the Settings panel (with a typed confirmation).

**When the Boss enters** (future multi-player roadmap): the union of all seated players' Banished Names becomes the table's enforcement set. A Boss player's Banished Names are enforced identically — any scene they will appear in must pass their union too.

---

## VI. Hallowed and Veiled Ground — Campaign-Level Softer Limits

Stored on the **campaign**, not the protagonist. These are softer than Banished Names: content may exist in the setting's lore, but the campaign has declared *how* it may appear.

Schema:

```js
campaign.hallowed = ["slavery-in-setting", "child-harm"];
campaign.veiled   = ["torture", "substance-withdrawal"];
```

- **Hallowed tags** — never narrated on screen. A scene attempting to tag Hallowed content at any intensity is refused.
- **Veiled tags** — may be tagged on a scene, but the scene's intensity ward is automatically downgraded to `suggested`. The engine enforces this silently — if the DM tries to write `explicit` or `visceral` prose for a Veiled element, the intensity toggle is disabled with a tooltip: *"This element is Veiled in this campaign — narration stays impressionistic."*

---

## VII. Mid-Scene Ward Operations

The Compact's Watches (§VIII of SAFETY.md) map to engine operations on active ward state:

| Watch signal | Effect on current scene |
|---|---|
| 🟡 **Dim** | No ward change; flag for the DM to ease specific beat. |
| 🌫️ **Veil** | Current scene's intensity is downgraded one tier (`visceral` → `explicit`, `explicit` → `suggested`) for the remainder of the scene. Engine writes the override as `scene.intensityOverride`. |
| 🔥 **Stoke** | No ward change; flag affirmative. Still cannot exceed the scene's authored intensity. |
| ✍️ **Rewrite** | Last narration beat stricken from session log. Branch choice, if made, is reverted. |
| 🟠 **Hold** | All branch buttons disabled; narration input read-only. |
| 🔴 **Snuff** | Session ended. Forced navigation to Hearth. Scene queue cleared. |

Stoke **cannot upgrade** a scene past its authored intensity. If a scene is `suggested`, Stoke is an encouragement, not a permission slip for explicit prose.

---

## VIII. Authoring Checklist

Every scene should answer before save:

- [ ] At least one **element ward** selected.
- [ ] Exactly one **intensity ward** chosen.
- [ ] Exactly one **frame ward** chosen.
- [ ] If any element ward is **hard-gated**, the protagonist owner has acknowledged.
- [ ] No element ward matches any protagonist's **Banished Name**.
- [ ] No element ward is in the campaign's **Hallowed** list.
- [ ] If any element ward is in the campaign's **Veiled** list, intensity is `suggested`.
- [ ] Scene narrative and branch narratives do not contain on-page content for Hallowed elements.
- [ ] The first scene of a new campaign is intensity `suggested`.
- [ ] The scene is not a second consecutive `visceral` in the scene graph.

These checks can be enforced at save time in the engine; most of them are mechanical.

---

## IX. Player-Facing Display

Before a scene opens, the player view must display:

```
✦ Warded Entry ✦
Elements:  intimacy · power-exchange · restraint
Intensity: explicit
Frame:     consensual-if
```

Below the wards, two buttons:
- **✦ Enter the Scene** — advances narration.
- **🕯️ Signal the Ember** — opens the pause overlay.

The scene does not auto-advance past the ward display on a timer. Silence is permitted. The player confirms in their own time.

---

## X. Retiring and Revising Wards

- **Adding an element ward to the roster:** either player may propose. Both must agree. The new tag is appended to `campaign.customWards`.
- **Retiring a Banished Name:** from the Settings panel only. Requires typing the exact tag name into a confirmation field. The retirement is timestamped and logged in the Hearth journal. The Name can be re-added at any time, instantly, no confirmation — tightening is always frictionless; loosening is never.
- **Reclassifying Veiled to Open:** campaign owner action. Requires mutual acknowledgement from both players in the Threshold of the next session — the reclassification does not take effect until the next Threshold is sealed.

These asymmetries are intentional. Raising a ward is always easy; lowering one always waits for the Threshold.

---

## XI. The Default Roster for a Fresh Campaign

When a campaign is created, the Grimoire seeds:

```js
campaign.customWards = [];
campaign.hallowed    = ["child-harm", "real-world-sexual-assault"];
campaign.veiled      = [];
campaign.hardGated   = [
  "noncon-roleplay", "dubcon-roleplay", "captivity", "pain",
  "blood", "breath", "body-horror", "humiliation"
];
```

The two Hallowed defaults are non-removable by any workflow. They are the floor of the Compact. `child-harm` covers any content involving minors in a sexual or exploitative frame; `real-world-sexual-assault` prevents the campaign from being used to re-enact or closely parallel a named real-world incident as a sexual scene.

---

## XII. Cross-Reference

- **Ember signals** — `SAFETY.md` §II, `pause.html` (Ember panel)
- **Threshold rite** — `SAFETY.md` §III, `pause.html` (Threshold panel)
- **Hearth stations** — `SAFETY.md` §V, `pause.html` (Hearth panel)
- **Fourth Response (Fawn)** — `SAFETY.md` §VII — implemented as the fourth branch in scene authoring and live session controls

---

*Velvet Grimoire — The Ward Roster, v1.0*
*"A ward spoken is a ward raised."*
