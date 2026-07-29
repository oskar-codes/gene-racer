I want you to build a complete browser game (HTML/CSS/JavaScript only, no backend, no frameworks) for a classroom activity about Artificial Intelligence.

The game should simulate autonomous racing cars whose behavior is controlled by a small set of tunable AI parameters ("genes"). Students do **not** write code—they only adjust these parameters to optimize their car.

The game should feel polished, colorful, fun, and suitable for children aged 11–15.

---

# Goal

Students work in teams.

Each team tunes the genes of its AI driver.

They can repeatedly test their driver on the same race track, observe its behavior, improve the parameters, and eventually enter a final tournament where all teams race simultaneously.

The activity should last roughly one hour.

The emphasis is on experimentation, optimization, and understanding that changing AI parameters changes behavior.

---

# Game

Top-down 2D racing game.

Simple but visually appealing.

Cars automatically drive around a closed circuit.

The objective is to complete as many laps as possible within a fixed time (e.g. 90 seconds).

Cars must avoid:

* walls
* barriers
* other cars

Collisions slow them down.

Driving off the track incurs a large speed penalty.

---

# AI

Do NOT use machine learning.

Implement a believable autonomous driver using:

* steering behaviors
* waypoint following
* virtual sensors ("raycasts")
* weighted decision making
* finite-state logic

The AI should genuinely depend on the genes.

Students should be able to observe meaningful behavioral differences.

---

# Sensors

Each car has virtual sensors detecting:

* track boundaries
* upcoming turns
* obstacles
* opponent cars

The AI decides steering and throttle based on these inputs.

Display the sensor rays during testing so students can understand what the AI is "seeing."

---

# Genes

Students can only modify these parameters.

Each ranges from 0–100.

1. Maximum speed
2. Acceleration
3. Braking aggressiveness
4. Turning aggressiveness
5. Corner anticipation
6. Overtaking aggressiveness
7. Safety margin from walls
8. Recovery speed after mistakes

Each gene must have a real influence.

Examples:

Maximum speed:
Higher top speed but harder to control.

Acceleration:
How quickly the car reaches maximum speed.

Braking aggressiveness:
How early the AI brakes before corners.

Turning aggressiveness:
How sharply it steers.

Corner anticipation:
How far ahead the AI plans.

Overtaking:
How willing it is to pass other cars.

Safety margin:
How closely it drives near walls.

Recovery:
How quickly it returns to the racing line after leaving the track.

Avoid hidden "best" values. Every parameter should involve trade-offs.

---

# Tracks

Include several tracks:

Easy Oval

Technical Circuit

Chicane Track

Mountain Road

Students should mainly practice on one chosen track.

Tournament mode should use that same track for every team.

---

# User Interface

Large classroom-friendly interface.

Left:

* race track
* animated cars
* lap counter
* timer
* current speed

Right:

gene sliders

short explanation under each slider

Buttons:

Run Test

Reset

Randomize

Save Driver

Load Driver

---

# During testing

Allow only one car.

Display:

* racing line
* sensor rays
* braking zones
* steering direction

Students should easily understand why the car made each decision.

---

# Tournament Mode

This is the most important feature.

Allow importing many drivers.

Each driver consists of:

* team name
* gene values

Press "Start Tournament."

All cars race simultaneously.

Everyone uses:

* identical physics
* identical track
* identical starting conditions

Display:

live leaderboard

lap count

best lap

current position

The tournament should be exciting to watch on a projector.

At the end:

show podium

gold, silver and bronze

confetti animation

---

# Randomness

Support random seeds.

Practice mode may use random seeds.

Tournament mode always uses one fixed seed for fairness.

---

# Visual Style

Modern.

Bright colors.

Smooth animations.

Cute but not childish.

Looks like an educational game rather than a simulation.

---

# Technical Requirements

Use only:

* HTML
* CSS
* vanilla JavaScript

No backend.

No frameworks.

Everything should run locally.

Keep the code modular and well-commented.

---

# Nice extras

Ghost replay of the previous run.

Speed controls (1×, 2×, 4×).

Dark mode.

Keyboard shortcuts.

Replay button.

Statistics after every run:

* average speed
* collisions
* off-track time
* braking events
* steering smoothness

Graphs comparing the current run with the previous one.

---

The final result should feel like a polished educational game that encourages experimentation. Students should clearly see that changing the genes changes the AI driver's racing style, and the tournament should be exciting enough that an entire classroom enjoys watching the final race.
