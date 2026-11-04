# Stage 35 clarification: relocation origin

User-confirmed rule (2026-11-04): the origin is each game's own start year. Relocation boundaries are `gameStartYear + 150 * n`, n=1,2,3,..., not a fixed global 2100/2200. For example: start 1950 -> 2100,2250,2400; start 2000 -> 2150,2300,2450; start 2050 -> 2200,2350,2500.

This clarification supersedes any hard-coded 2200/2350/2500 statements in Stage 35 implementation brief or earlier plans. Fully unattended automatic mode skips eligible boundaries without changing the origin or resetting the clock. Returning to manual mode triggers only the next future boundary, not a retroactive one. Save/reload must preserve the original game start year, including when relocation happens. Add tests for multiple start years and auto/manual switching.

This file is a specification clarification, not an implementation or test result. Do not merge to main or deploy Pages without authorization.
