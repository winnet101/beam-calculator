# Beam bending learning lab

A standalone, offline-capable web calculator inspired by the provided screenshot and `Downloads/document1.pdf` (AME 101 Lab HW #2, High-Speed Rail Beam). No framework, external assets, installation step, or runtime dependencies. Requires a modern browser and Node.js 18+.

## Live site & deployment

**https://winnet101.github.io/beam-calculator/**

The GitHub Actions workflow in `.github/workflows/pages.yml` runs the numerical tests and syntax checks on every push to `main`, then deploys only the six static app assets to GitHub Pages. No Node server runs on Pages; calculation and saved studies stay in your browser. Local development and the hosted site have separate browser storage because they use different origins.

To publish updates, commit and push to `main`. GitHub Pages must use **GitHub Actions** as its source in the repository settings.

## Run

```sh
cd /home/warren/Projects/beam-calculator
npm start
```

Open **http://localhost:5173**. To use another port: `PORT=8080 npm start`. The server binds only to your computer's loopback interface.

```sh
npm test       # numerical regression tests
npm run check  # JavaScript syntax checks
```

## Features

- All four reference load cases: cantilever tip force, simply supported center force, simply supported uniform load, cantilever uniform load.
- Solid rectangular and I-beam sections; sliders and numeric inputs for geometry, E, ν, density, and load.
- Total force F (kN) or distributed line load q (kN/m); switching units preserves total force. Point loads always use kN.
- Geometric or custom inertia, area, mass, bending moment, extreme-fiber stress, displacement, slenderness, and small-deflection warnings.
- Live finite-element estimate with voxel-integrated section properties, deformed elevation, signed equivalent stress coloring, and adjustable mesh and deformation scale.
- Rail assignment preset and C1–C4 checks. The starting I-beam is a demonstration, **not a claimed optimum or FEA-certified design**.
- Part 2 minimum-mass sizing using exhaustive discrete grid search (default) or multi-start projected gradient descent, selectable EB/Timoshenko constraints, deflection margin, convergence history, local inertia-per-kilogram sensitivities, and explicit candidate application.
- Enter actual Onshape displacement, record geometries, compare EB / beam FE / Onshape on a scatter plot, export CSV, and print to PDF. Actual FEA entry is cleared whenever model inputs change to prevent attaching a result to a different model.
- Parameters and up to 100 geometry records are saved in browser local storage. If storage is unavailable, the calculator still works. Reset changes current inputs, not the saved study; Clear study deletes records after confirmation.
- Responsive layout, labeled keyboard-accessible inputs, and print styles with formulas and substitutions.

**Load rail assignment** restores the PDF's 304 steel defaults, 12 m span, 57.8 kN total uniform load, and I-section. **Reset** loads the screenshot's rectangular example: 4 m × 400 mm × 600 mm, E = 193 GPa, ν = 0.29, q = 5 kN/m. Its EB displacement is 0.115 mm and the voxelized beam estimate is about 0.118 mm.

For Problem 1, record at least three geometries at different L/a values, entering the actual matching Onshape result before recording each one. The plot displays points rather than implying interpolation across different sections/materials/load cases. CSV includes all model inputs. The current model's formula, numeric substitutions, and results are under **Calculation with units** and included when printing. The app does not manufacture Onshape plots or write the required interpretation for you.

## Part 2 minimum-mass solver

Choose **Euler–Bernoulli** to size to the PDF equations, or **Timoshenko** to include the approximate clear-web shear contribution. The default 10% margin targets 36 mm rather than the 40 mm limit; this is a user-selected analytic margin, not an FEA error calibration or guarantee. The solver uses the current E, ν, and density, but resets section, load case, total force, and custom inertia to the assignment configuration. The result displays the material properties actually used. Changing current inputs afterward does not alter an already computed candidate; applying that candidate restores its displayed material values too.

### Exhaustive discrete grid (`grid-search.js`, default)

Continuous dimensions have infinitely many possible values. Select step sizes to define a finite grid:

- Heights: Δa, 2Δa, … ≤ 1000 mm, plus the 1000 mm boundary if it is not a step multiple.
- Thicknesses: 8 + nΔτ mm, for nonnegative integers n and τ < 500 mm; pairs with a ≤ 2τ are rejected.
- Widths: positive integer multiples of Δb with b ≥ τ, limited by an optional user cap. The PDF itself has no width cap; leaving it blank uses the engine ceiling of 100,000 mm.
- L = 12 m, uniform total force F = 57.8 kN, geometric I, and the current material properties. These model assumptions are the same as in the gradient solver.

For every a/τ pair, the algorithm solves for its smallest feasible width, rounds upward to the width grid, then recomputes droop and advances another width step if necessary to enforce **strictly less than the target**. At margin = 0, this means strictly less than 40 mm; the PDF permits equality, but the grid search intentionally implements the user's stricter request. Grid values are not subsequently rounded to the gradient method's 0.1 mm increments.

This reduction is equivalent to testing all grid widths **for minimum mass**: at fixed a and τ, mass rises with b, bending droop decreases with b, and the current I-beam shear term is independent of b. Every wider feasible width is heavier. The algorithm also checks up to ten width alternatives for each pair to retain the true ten lightest full-grid designs, not merely ten reduced-space minima. An independent small full three-dimensional enumeration verifies both the winning result and top-ten masses in tests.

Default steps (Δa = 10 mm, Δτ = 1 mm, Δb = 1 mm) check all **49,200 a/τ pairs**, including those rejected by geometry. Results separately report geometric and feasible pair counts. Up to 1,000,000 pairs are allowed; oversized grids are rejected before allocation. The search yields periodically for progress updates and cancellation. A cancelled search never applies or displays a partial candidate. The graph shows best feasible mass so far versus pairs checked. Expand the ranked candidate rows for proportional beam diagrams, exact dimensions, mass and droop.

The result is the **minimum on the defined finite grid under the selected analytic model**, not a guarantee between grid points or in Onshape. A finer nested grid can improve precision. These discrete-grid guarantees must not be confused with material verification, structural safety or FEA confirmation. With the above default steps, E = 193 GPa, ν = 0.29, ρ = 7850 kg/m³, and the default 10% Timoshenko margin, the minimum is a = 1000, b = 305, τ = 8 mm, mass ≈ 1201.24 kg, predicted droop ≈ 35.9445 mm.

### Multi-start gradient descent (`optimizer.js`)

Algorithm:

1. Set L = 12 m. At fixed total load F, increasing span increases mass, bending droop (proportional to L³), and shear droop (proportional to L); it cannot improve the objective or feasibility.
2. For a trial a and τ, calculate the minimum flange width analytically, exploiting I's linear dependence on b. If including shear, first subtract its displacement from the target; reject trials whose shear droop alone exceeds the target. Enforce b ≥ τ and the numerical engine's 100 m width ceiling; the PDF imposes no flange-width cap.
3. Minimize the resulting mass over scaled height and thickness variables using finite-difference gradients, projection onto a ≤ 1000 mm, τ ≥ 8 mm and a > 2τ, and an Armijo backtracking line search. Try nine fixed starts plus the current geometry when finite, retaining the lightest result. Each start allows up to 300 iterations.
4. Round height/thickness upward to 0.1 mm, re-size width, round it upward to 0.1 mm, and verify the selected analytic target again. Only **Apply candidate** changes the calculator; any old Onshape displacement is cleared.

This is a bounded local optimization heuristic, **not proof of a global minimum**. The convergence graph plots mass against iteration for every feasible start, with the winning run highlighted. Each starting point has its own expandable visualizer with an I-beam cross-section card for every iteration, including the initial geometry and any terminal no-move attempt. Cross-sections preserve height, width, and thickness proportions and use one drawing scale per start, so geometry changes are directly comparable within that run. Exact a/b/τ values and mass appear under each beam; very thin walls may be difficult to see at a shared scale. Expand a run's numerical diagnostics for its a/b/τ, mass, scaled gradient norm, step size, search attempts, and cumulative evaluation count at each iteration. A dashed card marks a terminal no-move iteration. The separate dimension line graphs have been removed. Iterations include rejected/terminal line-search attempts, so they are not the same as accepted updates. A projected-step or line-search stop is reported explicitly; it is not an optimality certificate. Section-voxel FE displacement may be slightly higher than the continuum Timoshenko sizing value because of sectional quadrature.

For E = 193 GPa, ν = 0.29, ρ = 7850 kg/m³:

| Sizing | Margin | a / b / τ (mm) | Mass (kg) | EB droop (mm) | Timoshenko droop (mm) |
|---|---:|---|---:|---:|---:|
| EB | 0% | 1000 / 249.5 / 8 | 1117.59 | 39.998 | 40.704 |
| Timoshenko | 0% | 1000 / 256.9 / 8 | 1128.74 | 39.290 | 39.997 |
| Timoshenko | 10% | 1000 / 304.3 / 8 | 1200.18 | 35.291 | 35.997 |

None of these rows is Onshape-confirmed. Use the library's actual 304 density; the PDF suggests approximately 8000 kg/m³. Density rescales the mass, but not optimal dimensions when self-weight is excluded.

### Why height helps (I is not M)

For this uniform cantilever, the external bending moment Mmax = F L/2 depends on load and span, not section dimensions. The second moment of area I measures how far material sits from the neutral axis, and appears in the **denominator** of δ = F L³/(8 E I). More I means less bending displacement.

A taller I-section moves its two flanges farther apart. Roughly, the flange contribution to I grows as flange area × (a/2)², while the added web mass grows approximately linearly in a. But simply noting the a³ terms in the exact formula is insufficient: the subtracted inner rectangle also changes.

The solver explanation displays the current geometry's exact local marginal efficiencies (∂I/∂x)/(∂m/∂x). With h = a−2τ and dimensions in SI:

```
∂I/∂a = [b a² − (b−τ) h²] / 4       ∂A/∂a = τ
∂I/∂b = [a³ − h³] / 12               ∂A/∂b = 2τ
∂I/∂τ = [h³ + 6(b−τ) h²] / 12        ∂A/∂τ = 2b + a − 4τ
∂m/∂x = ρ L ∂A/∂x
```

These comparisons hold other dimensions fixed. Height is especially effective for the tested thin-walled sections, but the efficiencies depend on geometry, constraints, and (when relevant) shear. Once a reaches the 1000 mm assignment bound, it cannot increase further. Thickness can become more valuable when shear rather than bending dominates. The solver therefore compares constrained mass numerically instead of hardcoding a = 1000 or τ = 8.

## Equations and units

Inputs use m for span, mm for section dimensions, GPa for E, kg/m³ for density, kN or kN/m for load, and mm⁴ for custom inertia. The engine converts everything to SI before solving.

I-beam dimensions: a = overall height; b = flange width; τ = thickness of both flanges and web. Require 2τ < a and τ ≤ b.

```
I = [b a³ − (b − τ)(a − 2τ)³] / 12
A = 2 b τ + (a − 2τ) τ
m = ρ A L
q = F / L
```

Euler–Bernoulli maximum displacement:

| Case | Displacement | Maximum moment |
|---|---|---|
| Cantilever tip | F L³ / (3 E I) | F L |
| Simply supported center | F L³ / (48 E I) | F L / 4 |
| Simply supported uniform | 5 q L⁴ / (384 E I) | q L² / 8 |
| Cantilever uniform | q L⁴ / (8 E I) | q L² / 2 |

Bending stress = M(a/2)/I. Self-weight is **not** added, matching the supplied PDF equations. 57.8 kN is used as the PDF's rounded equivalent of 13,000 lbf. Density affects mass, not the applied load.

## What the numerical model does (and does not do)

`beam.js` implements two-node, shear-flexible **1-D Timoshenko beam finite elements**. Each node has transverse displacement and rotation. It assembles stiffness and consistent uniform-load vectors, applies support constraints, and uses a banded Cholesky solve. Even length divisions ensure the center point load lands on a node.

Cross-section y–z cells are clipped against the selected solid rectangle or three non-overlapping I-section rectangles. Clipping conserves area, including thin flanges/webs. Centroid quadrature computes an approximate I, omitting each clipped fragment's own second moment. This converges from below to geometric I under height refinement. The occupied voxel count is the number of intersected section cells times length divisions, not a count of independent solid finite elements. For symmetric bending, width refinement does not change the answer; length refinement may also leave nodal extrema unchanged for these exact prismatic load cases. Height refinement controls sectional quadrature error.

- G = E/[2(1+ν)].
- Solid rectangle: Cowper κ = 10(1+ν)/(12+11ν), effective shear area κA.
- I-beam: approximate effective shear area (5/6)(a−2τ)τ. This is a web-only engineering approximation, **not Cowper's rectangular-section coefficient**.
- Continuum Timoshenko reference adds the exact shear displacement for these four load cases using the same effective shear area. Tests compare the FE solver with this reference using exact I.
- Custom I overrides both EB and FE stiffness and stress recovery. It does **not** redefine area, mass, or shear geometry. Assignment geometry compliance cannot be established with custom I enabled.
- Stress recovery uses σ = −My/I and approximate shear: parabolic through a rectangle or uniform within an I-beam's clear web. Displayed signed equivalent stress is sign(σ)√(σ²+3τ²), assigning positive sign at σ = 0. This is an educational visualization, not a failure criterion or local solid stress solution.
- Elevation is drawn to scale; deformation is magnified separately and explicitly labeled. Extreme displayed deformation is capped with a label so the diagram remains readable.

**This is not a 3-D voxel lattice or solid FEA.** It cannot resolve flange bending, local bearing stress, support concentrations, warping, buckling, yielding, nonlinear large deflections, or connection failure. Neither the plot nor the local model satisfies the assignment's requirement for **Onshape FEA confirmation**. Material remains unverified even after entering an FEA value. The app deliberately never claims overall structural safety or material confirmation.

## Files

- `index.html`, `styles.css`: accessible controls, panels, responsive/print layout.
- `app.js`: interaction, visualization, local persistence, study/CSV export.
- `beam.js`: independently testable numerical engine.
- `beam.test.js`: PDF formulas, screenshot benchmark, four analytical FE references, voxel convergence, unit conversion, boundary conditions, custom inertia, stress symmetry, and invalid inputs.
- `optimizer.js`, `optimizer.test.js`: reduced-space gradient descent, analytical width sizing and marginal sensitivities, with feasibility, monotonic descent, independent grid, and derivative regression tests.
- `grid-search.js`, `grid-search.test.js`: finite-grid enumeration with exact monotonic width elimination, strict feasibility, progress, cancellation, and independent full-grid regression tests.
- `server.mjs`: small local static server, serving only the six app assets.

Browser smoke checks were run with local Chromium: desktop/mobile rendering, all cases, the screenshot benchmark, recording, CSV download, persistence, invalid inputs, custom inertia, both optimizer models, margin validation, candidate application, stale FEA clearing, and PDF printing, with no JavaScript errors. Exhaustive-grid browser checks also cover model/method switching, grid counts, candidate application, invalid bounds, oversized-grid rejection, cancellation, mobile layout and PDF printing. The full numerical suite contains 34 passing tests.
