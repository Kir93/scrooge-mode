# taskline v2.3.0

## New features
- **Recurring tasks** — schedule tasks that repeat on a set cadence.
- **CSV export** — export your task list to CSV.

## Bug fixes
- Fixed timezone handling for deadlines that cross midnight (past-midnight deadlines now resolve to the correct day).
- Fixed crash when creating or saving a task with an empty title.

## Performance
- List rendering is ~2× faster.

## Breaking changes
- Dropped support for Node 16. Upgrade to a current LTS (Node 18+) before updating.
