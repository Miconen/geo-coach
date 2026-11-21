# Issue tracker

Issues live on GitHub (`Miconen/geo-coach`); use the `gh` CLI.

## Wayfinding operations

- **Map**: an issue labelled `wayfinder:map`.
- **Tickets**: GitHub native sub-issues of the map, each labelled with one `wayfinder:<type>` (`research`, `prototype`, `grilling`, `task`).
  - Add a child: `gh api -X POST repos/Miconen/geo-coach/issues/<map>/sub_issues -F sub_issue_id=<child database id>`
  - List children: `gh api repos/Miconen/geo-coach/issues/<map>/sub_issues`
- **Blocking**: GitHub native issue dependencies.
  - `gh api -X POST repos/Miconen/geo-coach/issues/<blocked>/dependencies/blocked_by -F issue_id=<blocker database id>`
  - List blockers: `gh api repos/Miconen/geo-coach/issues/<n>/dependencies/blocked_by`
- **Claim**: assign the ticket to yourself (`gh issue edit <n> --add-assignee @me`).
- **Frontier**: open sub-issues of the map that are unassigned and whose blockers are all closed.
- **Resolve**: post the answer as a comment, close the issue, and add a line to the map's "Decisions so far".
