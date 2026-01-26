/**
 * @fileoverview Shared JSDoc typedefs describing voyage data structures and event payload shapes.
 * These definitions support editor tooling without affecting runtime behaviour.
 */

/**
 * @typedef {Object} VoyageWind
 * @property {number} [speed] Speed over ground of the wind in knots, when reported.
 * @property {number} [direction] Wind direction in degrees true, when available.
 */

/**
 * @typedef {Object} VoyageSpeed
 * @property {number} [sog] Speed over ground in knots.
 * @property {number} [stw] Speed through the water in knots.
 */

/**
 * @typedef {Object} VoyageEntry
 * @property {string} [datetime] ISO timestamp associated with the log entry.
 * @property {VoyageWind} [wind] Nested wind metadata captured with the entry.
 * @property {VoyageSpeed} [speed] Nested speed metadata captured with the entry.
 * @property {string} [activity] Classified activity such as `sailing`, `motoring`, or `anchored`.
 * @property {boolean} [skipConnectionToNext] Flag signalling that the next point should not be connected.
 * @property {boolean} [skipConnectionFromPrev] Flag signalling that the previous point should not be connected.
 */

/**
 * @typedef {Object} VoyagePoint
 * @property {number} lat Latitude in decimal degrees.
 * @property {number} lon Longitude in decimal degrees.
 * @property {string} [activity] Classified activity for this point.
 * @property {boolean} [skipConnectionToNext] True when the segment from this point should be omitted.
 * @property {boolean} [skipConnectionFromPrev] True when the segment to this point should be omitted.
 * @property {VoyageEntry} [entry] Original parsed log entry, when available.
 * @property {VoyageWind} [wind] Inline wind data shortcut when present on the point.
 * @property {string} [manualLocationName] Optional location label for manual voyages.
 */

/**
 * @typedef {Object} VoyageSegment
 * @property {string} startTime ISO timestamp representing the first point in the segment.
 * @property {string} endTime ISO timestamp representing the last point in the segment.
 * @property {number} nm Nautical miles travelled within the segment.
 * @property {number} maxSpeed Highest recorded speed for the segment in knots.
 * @property {number[]} [maxSpeedCoord] `[lon, lat]` pair for the segment max-speed location.
 * @property {number} avgSpeed Average speed in knots.
 * @property {number} totalHours Total segment duration in hours.
 * @property {number} maxWind Highest recorded wind speed for the segment in knots.
 * @property {number} avgWindSpeed Average recorded wind speed in knots.
 * @property {number} [avgWindHeading] Mean wind direction in degrees.
 * @property {string} [dateKey] Optional label used when segments are keyed by date.
 * @property {VoyagePoint[]} points Ordered points belonging to the segment.
 * @property {any} [polyline] Leaflet polyline reference associated with the segment when rendered.
 * @property {boolean} [closeLoop] True when the segment should render as a closed loop.
 */

/**
 * @typedef {Object} Voyage
 * @property {number} _tripIndex One-based index representing the voyage’s position in the rendered table.
 * @property {VoyageSegment[]} [_segments] Cached trip segments prepared for rendering.
 * @property {any} [_fallbackPolyline] Leaflet polyline created when the voyage lacks explicit segments.
 * @property {boolean} [manual] True when the voyage was manually added.
 * @property {string} [manualId] Identifier for manual voyages stored on the server.
 * @property {ManualVoyageStop[]} [manualLocations] Ordered manual locations used to define legs.
 * @property {ManualRoutePoint[]} [manualRoutePoints] Ordered route points used for day-trip loop edits.
 * @property {number} [manualRouteTurnIndex] Index of the turnaround point within the route points array.
 * @property {boolean} [returnTrip] True when a manual voyage returns to the start location.
 * @property {ManualLocation} [startLocation] Named starting location for manual voyages.
 * @property {ManualLocation} [endLocation] Named ending location for manual voyages.
 * @property {number} nm Total nautical miles travelled during the voyage.
 * @property {number} maxSpeed Maximum recorded speed over ground in knots.
 * @property {number[]} [maxSpeedCoord] `[lon, lat]` pair for the voyage max-speed location.
 * @property {number} avgSpeed Mean speed over ground in knots.
 * @property {number} [totalHours] Total duration in hours, summed across legs when multiple legs exist.
 * @property {number} maxWind Maximum wind speed recorded in knots.
 * @property {number} avgWindSpeed Mean wind speed in knots.
 * @property {number} [avgWindHeading] Mean wind direction across the voyage in degrees.
 * @property {VoyagePoint[]} [points] Preferred array of voyage points.
 * @property {VoyagePoint[]} [entries] Alternate array of voyage points preserved from parsing.
 * @property {Array<[number, number]>} [coords] Fallback coordinate pairs `[lon, lat]` when point objects are unavailable.
 */

/**
 * @typedef {Object} ManualLocation
 * @property {string} name Human-readable location name.
 * @property {number} lat Latitude in decimal degrees.
 * @property {number} lon Longitude in decimal degrees.
 */

/**
 * @typedef {Object} ManualRoutePoint
 * @property {number} lat Latitude in decimal degrees.
 * @property {number} lon Longitude in decimal degrees.
 */

/**
 * @typedef {Object} ManualVoyageStop
 * @property {string} name Human-readable stop name.
 * @property {number} lat Latitude in decimal degrees.
 * @property {number} lon Longitude in decimal degrees.
 * @property {string} time ISO timestamp for the stop.
 */

/**
 * @typedef {Object} ManualVoyageRecord
 * @property {string} id Unique identifier for the manual voyage.
 * @property {ManualVoyageStop[]} [locations] Ordered manual locations for multi-leg voyages.
 * @property {ManualRoutePoint[]} [routePoints] Ordered loop points for manual day trips.
 * @property {number} [routeTurnIndex] Index of the turnaround point within the loop.
 * @property {boolean} [returnTrip] True when a manual voyage returns to the start location.
 * @property {string} startTime ISO timestamp for the voyage start time.
 * @property {string} endTime ISO timestamp for the voyage end time.
 * @property {ManualLocation} startLocation Named start location coordinates.
 * @property {ManualLocation} endLocation Named end location coordinates.
 * @property {string} [createdAt] ISO timestamp of when the manual voyage was created.
 * @property {string} [updatedAt] ISO timestamp of when the manual voyage was updated.
 */

/**
 * @typedef {Object} ManualVoyagePayload
 * @property {ManualVoyageRecord[]} voyages Stored manual voyage records.
 */

/**
 * @typedef {Object} VoyageTotals
 * @property {number} totalDistanceNm Total nautical miles across all voyages.
 * @property {number} totalActiveMs Total active duration in milliseconds from leg durations.
 * @property {number} totalSailingMs Total sailing duration in milliseconds.
 */

/**
 * @typedef {Object} VoyageSelectionOptions
 * @property {boolean} [fit] When true the map should refit to the voyage bounds.
 * @property {boolean} [scrollIntoView] When true the associated table row should be scrolled into view.
 * @property {boolean} [suppressHistory] Stops history updates when true.
 */

/**
 * @typedef {Object} VoyageFocusPoint
 * @property {VoyagePoint} point Point to select after the voyage is highlighted.
 * @property {VoyagePoint} [prev] Previous point in the series for bearing estimation.
 * @property {VoyagePoint} [next] Next point in the series for bearing estimation.
 */

/**
 * @typedef {Object} VoyageSelectionPayload
 * @property {Voyage} voyage Voyage that should become the active selection.
 * @property {HTMLTableRowElement} [row] Table row element associated with the voyage.
 * @property {VoyageSelectionOptions} [options] Behaviour flags applied to the selection.
 * @property {string} [source] Identifier describing the selection trigger.
 * @property {*} [metadata] Additional metadata describing the selection context.
 * @property {VoyageFocusPoint} [focusPoint] Optional point to focus once the voyage is active.
 */

/**
 * @typedef {Object} SegmentSelectionPayload
 * @property {Voyage} voyage Voyage that contains the target segment.
 * @property {HTMLTableRowElement} [row] Table row associated with the voyage (not the leg row).
 * @property {VoyageSegment} segment Segment that should be highlighted.
 * @property {VoyageSelectionOptions} [options] Behaviour flags applied to the parent voyage selection.
 * @property {string} [source] Identifier describing the selection trigger.
 * @property {*} [metadata] Additional metadata describing the selection context.
 */

/**
 * @typedef {Object} MaxSpeedPayload
 * @property {Voyage} voyage Voyage owning the max-speed point.
 * @property {HTMLTableRowElement} [row] Table row associated with the voyage.
 * @property {VoyageSegment} [segment] Segment containing the max-speed point when scoped to a leg.
 * @property {number[]} coord `[lon, lat]` pair marking the max-speed location.
 * @property {number} speed Speed in knots for the tooltip.
 * @property {VoyageSelectionOptions} [options] Behaviour flags applied to the parent selection.
 * @property {string} [source] Identifier describing the selection trigger.
 */

/**
 * @typedef {Object} ResetPayload
 * @property {string} [source] Identifier describing the reset trigger.
 */

export {};
