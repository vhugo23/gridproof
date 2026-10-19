import type { ChallengeId } from "../challenges/deriveChallenge";
import type { AssetId } from "../lab/assets";

export type ApplicationAction = {
  label: string;
  /** Equipment preselected in the lab inspector, or null to just open the lab. */
  asset: AssetId | null;
  /** Guided challenge shown above the inspector, if any. */
  challenge?: ChallengeId;
  /** Honest note about what the lab does and does not model. */
  note: string;
};

export type Application = {
  id: string;
  title: string;
  caption: string;
  image: string;
  alt: string;
  summary: string;
  /** Educational, qualitative points; general engineering context, not GridProof results. */
  considerations: string[];
  action?: ApplicationAction;
};

export const APPLICATIONS: Application[] = [
  {
    id: "power-generation",
    title: "Power generation",
    caption: "Generator sets for standby and prime power.",
    image: "/illustrations/generator-set.svg",
    alt: "Illustration of an enclosed generator set on a fuel-tank skid with louvered doors and an exhaust silencer.",
    summary:
      "A generator set pairs an engine with an alternator to supply electricity when the utility is unavailable or where no grid exists. In critical facilities the units sit behind switchgear that detects an outage, starts them and transfers the load once their power is ready.",
    considerations: [
      "Start and transfer time: how long the load can go without power decides whether generators alone are enough or storage must bridge the gap.",
      "Load acceptance: engines take large load steps in stages, so sequencing and capacity margin matter.",
      "Redundancy: more than one unit lets the system tolerate a failure to start.",
      "Fuel and runtime: how long a site must run unattended shapes fuel storage and refueling plans.",
    ],
    action: {
      label: "Start the G1 startup challenge in the Fridley lab",
      asset: "g1",
      challenge: "g1-startup",
      note: "Lengthen G1's startup delay, save it, run the real startup check and inspect the readiness requirement. It uses your own workspace and never saves for you. All values are synthetic.",
    },
  },
  {
    id: "motors-electrical",
    title: "Motors and electrical components",
    caption: "Industrial motors and the electrical gear that controls them.",
    image: "/illustrations/motors-electrical.svg",
    alt: "Illustration of a finned industrial electric motor on a base frame beside a motor control cabinet.",
    summary:
      "An electric motor turns electrical energy into shaft power for pumps, fans, compressors and conveyors; an alternator is the same kind of machine run in reverse. Around a motor sit starters, drives, protection and control cabinets that decide how and when power reaches it.",
    considerations: [
      "Starting current: a motor can draw much more current while starting than while running, which the supply must tolerate.",
      "Protection: overload, short-circuit and ground-fault devices have to be coordinated so only the faulted branch trips.",
      "Cooling and duty cycle: how often and how long a motor runs sets its thermal limits.",
      "Control method: across-the-line, soft-start and drive-based control trade complexity against smoother starting.",
    ],
    action: {
      label: "Open the Fridley lab",
      asset: null,
      note: "The virtual lab does not model motors. It covers generators, battery storage, switchgear, the utility and a critical load.",
    },
  },
  {
    id: "storage-switchgear",
    title: "Battery storage and switchgear",
    caption: "Energy storage and power distribution equipment.",
    image: "/illustrations/storage-switchgear.svg",
    alt: "Illustration of a containerized battery storage enclosure next to a switchgear lineup.",
    summary:
      "Battery energy storage delivers power almost instantly through an inverter, while switchgear connects sources and loads and isolates faults. Together they can carry a load through the seconds before generators are ready to take over.",
    considerations: [
      "Ride-through: how long a battery can carry the load depends on its usable energy and the minimum state of charge it must keep.",
      "Inverter power: the inverter rating, not only the stored energy, limits how much load the battery can support.",
      "Transfer logic: switchgear settings decide when sources connect and how the load moves between them.",
      "Isolation and maintenance: equipment must be separable so one part can be serviced safely.",
    ],
    action: {
      label: "Start the battery continuity challenge in the Fridley lab",
      asset: "battery",
      challenge: "battery-continuity",
      note: "Predict, then verify with the real startup check, what happens when critical demand exceeds the battery inverter limit. It uses your own workspace and never saves for you. All values are synthetic.",
    },
  },
  {
    id: "mining-off-highway",
    title: "Mining and off-highway",
    caption: "Heavy-duty haul trucks and off-highway machines.",
    image: "/illustrations/mining-vehicles.svg",
    alt: "Illustration of a large mining haul truck with a loaded ribbed dump body and oversized tires.",
    summary:
      "Mining and other off-highway machines, such as large haul trucks, work long shifts in dust, heat and vibration, often far from service support. Their power systems are sized for heavy, repeated duty cycles rather than occasional use.",
    considerations: [
      "Duty cycle: sustained high load over long shifts drives cooling, durability and maintenance planning.",
      "Environment: dust, temperature and altitude affect air filtration and how much power an engine can deliver.",
      "Serviceability: remote sites make uptime and ease of repair as important as peak performance.",
      "Energy logistics: delivering fuel or other energy to a remote site is a design constraint in its own right.",
    ],
  },
  {
    id: "on-highway-mobile",
    title: "On-highway trucks and mobile power",
    caption: "Long-haul trucks and power on the move.",
    image: "/illustrations/on-highway-trucks.svg",
    alt: "Illustration of a long-haul tractor with a sleeper cab pulling a box trailer.",
    summary:
      "On-highway trucks move freight over long distances and spend much of their time at steady highway speed. Mobile power applies a vehicle- or trailer-mounted source to supply electricity where a fixed supply is unavailable, such as work sites, events or emergency response.",
    considerations: [
      "Duty profile: long steady running differs from stop-and-go work, and the power system is tuned to the profile.",
      "Emissions and noise: regulations and the operating location constrain what equipment can be used.",
      "Packaging: weight and space on a vehicle or trailer limit how much equipment fits.",
      "Refueling and uptime: availability of fuel and service along the route shapes operations.",
    ],
  },
];
