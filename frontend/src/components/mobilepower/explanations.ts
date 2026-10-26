// Educational text for the Mobile-Site Power Planner. It describes what each
// calculation is for and what it cannot tell you; every number shown next to it
// comes from the backend response. General engineering context, not GridProof results.

export type Explanation = {
  id: string;
  title: string;
  purpose: string;
  limits: string;
};

export const EXPLANATIONS: Explanation[] = [
  {
    id: "connected",
    title: "Connected load",
    purpose:
      "The sum of quantity × rated kW for every load on the list: what the site could draw if everything ran flat out together. It is the upper bound that the simultaneity factors then reduce.",
    limits:
      "Rated kW is whatever you entered. Nameplate and running power differ, and the model does not know either. It also ignores power factor, so it says nothing about kVA.",
  },
  {
    id: "demand",
    title: "Simultaneous (modeled) demand",
    purpose:
      "Each load's connected kW multiplied by its simultaneity factor, then added up. Planners use it because not every load runs at the same moment, so sizing for the full connected load can be needlessly large.",
    limits:
      "A simultaneity factor is your planning assumption, not a measured peak concurrency or a physical operating schedule. The model cannot check it, and a wrong factor moves the result directly.",
  },
  {
    id: "required",
    title: "Required capacity with margin",
    purpose:
      "Modeled demand increased by the capacity margin you chose. A margin leaves room for load growth and for estimates that turn out low.",
    limits:
      "The margin is a flat percentage on kW. It does not represent motor starting, step loading, derating or any other specific effect.",
  },
  {
    id: "contribution",
    title: "Contribution by load",
    purpose:
      "Each bar segment is one load's share of modeled demand (its demand kW divided by the total), in the order you entered the loads. “Largest demand” marks the load with the most modeled demand, so you can see which assumption matters most.",
    limits:
      "This is not a ranking of anything else and has no connection to the package ratings. Shares are rounded to 2 decimals and can add up to slightly more or less than 100%.",
  },
  {
    id: "packages",
    title: "Package comparison",
    purpose:
      "Each of the four invented packages is compared by rated kW with the required capacity (modeled demand) and, as a sensitivity check, with the all-simultaneous requirement (every load at factor 1.00). Headroom is rating minus requirement; utilization is requirement divided by rating.",
    limits:
      "The packages are synthetic, not Cummins products. The comparison is steady-state kW only and is not validation of kVA, power factor, voltage, motor starting, step loading, derating, protection, fuel, emissions or equipment suitability. Packages are listed by rating, not ranked, and nothing is recommended.",
  },
  {
    id: "ladder",
    title: "Capacity ladder",
    purpose:
      "One kW scale. The solid fill runs up to the required capacity, the hatched band stretches to the all-simultaneous requirement, and each tick is a package rating. A package whose tick sits to the right of the hatched band meets both; one inside the band meets modeled demand only; one to the left of the solid fill does not meet modeled demand.",
    limits:
      "Positions are drawn to scale only for orientation; the exact comparisons are done by the server on unrounded values, so a package can sit visually on a marker and still fall on either side of it.",
  },
];
