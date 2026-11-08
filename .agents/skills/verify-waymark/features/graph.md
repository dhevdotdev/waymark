# Graph

## Sub-features

Whole-vault graph, one-note neighbourhood, community chips, local graph in the inspector.

## How to get to it (user POV)

⌘G opens the graph as a tab. ⌘⇧G opens it around the current note.

## Driving it with Playwright

Press `Meta+g`, read `.graph-stats`, click `[data-gmode="local"]`, scroll `.graph-groups`. `.tab.is-graph-tab.is-active` proves it is a tab. Escape leaves.

## Gotchas

The canvas holds no DOM per note, so assert through `.graph-stats`, or take a screenshot. Under Reduce Motion the intro is skipped.
