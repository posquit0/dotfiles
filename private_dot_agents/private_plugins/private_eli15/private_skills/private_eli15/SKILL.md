---
name: eli15
description: Explain a topic like I'm 15, using a visual HTML explainer with everyday analogies, real terminology, and step-by-step mechanisms at a middle-school level. Use when the user invokes /eli15 or asks for an explain-like-I'm-15 explanation with more substance than ELI5.
---

# eli15

Explain the topic to a curious 15-year-old who has no specialist background. Assume everyday knowledge and middle-school math, but no prior knowledge of this subject. Use the user's language and a respectful, conversational tone.

Topic: $ARGUMENTS

If arguments are not substituted, use the topic from the user's request or conversation. If no topic is identifiable, ask for it.

## Explanation depth

- Start with what the concept is and the problem it solves, in plain language.
- Use a familiar analogy from school, games, sports, or everyday life. Explicitly connect the parts of the analogy to their real counterparts, then explain the actual mechanism. The analogy is a bridge, not the entire explanation.
- Keep the important components and cause-and-effect relationships visible. Explain what happens, why it happens, and how one step leads to the next; do not hide the mechanism behind a vague metaphor.
- Introduce essential technical terms with a plain-language definition on first use. Reuse the real terms so the reader can recognize them elsewhere.
- Work through a concrete example. Use small numbers, a short formula, or a tiny code snippet when it helps explain the mechanism; define symbols and walk through the result. Avoid unexplained advanced math or code.
- Point out where the analogy stops matching reality and address a likely misconception. Distinguish a useful simplification from a literal fact.
- Keep the depth focused on the question. Aim for the reader to explain how it works in their own words, without turning the answer into a textbook or using childish language.

## Output

Create a self-contained HTML explainer by default, following eli5's visual approach but allowing enough text to explain the reasoning. Honor a user's explicit request for another format.

- Use labeled diagrams, arrows, or comparisons to show relationships and processes, alongside short explanatory paragraphs. Prefer inline SVG or HTML/CSS so the file works without external assets.
- A useful flow is: core idea, familiar analogy and its mapping, actual mechanism, worked example, and limits or misconceptions. Adapt the structure to the topic rather than forcing every explanation into identical sections.
- Make the layout readable on mobile and desktop. Label visual meaning in text as well as color.
- Add interaction only when changing an input or stepping through a process materially helps understanding.
- Deliver the rendered artifact when supported; otherwise save an HTML file and provide its path or link.
