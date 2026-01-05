/**
 * Selective D3 imports to reduce bundle size
 * Instead of importing the entire d3 library, we import only what we need
 */

// Core selection and manipulation
export { select, selectAll, pointer } from 'd3-selection';

// Scales
export { 
  scaleLinear, 
  scaleTime, 
  scaleOrdinal, 
  scaleBand,
  scalePoint,
  scaleLog,
  scalePow,
  scaleSqrt,
  scaleSequential
} from 'd3-scale';

// Axes
export { axisBottom, axisLeft, axisTop, axisRight } from 'd3-axis';

// Shapes (lines, areas, curves)
export { 
  line, 
  area,
  lineRadial,
  areaRadial,
  arc,
  curveLinear, 
  curveMonotoneX, 
  curveBasis,
  curveCatmullRom,
  curveLinearClosed,
  stack,
  stackOffsetExpand,
  stackOffsetWiggle,
  stackOrderInsideOut
} from 'd3-shape';

// Path
export { path } from 'd3-path';

// Formatting
export { format, formatLocale } from 'd3-format';
export { timeFormat, timeParse, utcFormat, utcParse } from 'd3-time-format';

// Arrays
export { 
  extent, 
  min, 
  max, 
  sum, 
  mean, 
  median,
  quantile,
  bisector,
  bisectLeft,
  bisectRight,
  range
} from 'd3-array';

// Time
export { 
  timeYear, 
  timeMonth, 
  timeWeek, 
  timeDay, 
  timeHour,
  timeMinute,
  timeSecond,
  timeMillisecond
} from 'd3-time';

// Transitions
export { transition } from 'd3-transition';
export { easeSinInOut } from 'd3-ease';

// Color schemes and interpolators
export { 
  schemeCategory10,
  schemePaired,
  schemeSet3,
  schemeTableau10,
  interpolateBlues,
  interpolateBuGn,
  interpolatePurples,
  interpolateBuPu,
  interpolateOranges
} from 'd3-scale-chromatic';

// Color manipulation
export { rgb } from 'd3-color';

// Re-export commonly used types
export type { Selection } from 'd3-selection';
