/** Default solution / fallback per fault type, in plain language (shown in the alert and in the e-mail). */
export type FaultType = 'battery' | 'pv' | 'outage' | 'cable' | 'substation' | 'generic';

export interface PlaybookEntry {
  label: string;
  /** plain-language account of what happened and why it matters (no numbers: those come from the sim) */
  happened: string[];
  /** 1-2 short lines: what the campus does while the fault lasts */
  solution: string[];
}

export const FAULT_PLAYBOOK: Record<FaultType, PlaybookEntry> = {
  battery: {
    happened: ["A battery unit tripped (protection or inverter fault) and is taken out of service.", "The agent can no longer charge in cheap/clean hours or discharge in expensive/dirty ones, so savings vs. no battery shrink while the unit is down."],
    label: 'Battery fault',
    solution: ['Grid only, battery isolated: buy everything the campus needs from the grid.', 'Solar keeps covering what it can; no storage until the unit is repaired.'],
  },
  pv: {
    happened: ["The inverter of this roof's solar array reports no output, so the array is switched off.", "The campus loses that solar energy and must replace it from the battery or the grid, which raises cost and CO2 during daylight."],
    label: 'Solar panel fault',
    solution: ['Cover the load from the battery first, then from the grid.', 'The faulty array is isolated; other roofs keep producing.'],
  },
  outage: {
    happened: ["The connection to the public grid is lost for the simulated window.", "Only battery and solar can supply the campus; if they fall short, part of the demand goes unserved and non-critical loads must be shed."],
    label: 'Grid outage / grid import fault',
    solution: ['Island on battery and solar; shed non-critical loads if they cannot cover the campus.', 'When the grid is back, reconnect and buy everything from the grid until storage recovers.'],
  },
  cable: {
    happened: ["A feeder cable is damaged or tripped, cutting supply to the buildings on that line.", "Those buildings need to be rerouted or isolated until the cable is repaired."],
    label: 'Cable fault',
    solution: ['Reroute the supply through the neighbouring feeder and isolate the damaged section.', 'Non-critical loads on the faulty line stay off until repair.'],
  },
  generic: {
    happened: ['The monitoring system raised an alarm for this asset or condition.', 'It does not match a known equipment fault, so check the readings before acting.'],
    label: 'Alarm',
    solution: ['Check the asset and its latest readings on the map and the timeline.', 'If it persists, contact the on-call technician.'],
  },
  substation: {
    happened: ["A substation is down, so the buildings it feeds lose their normal supply.", "Local battery and solar can island them while the grid side is repaired."],
    label: 'Substation fault',
    solution: ['Island the affected buildings on local battery and solar.', 'Buy from the grid through the healthy substation for the rest.'],
  },
};
