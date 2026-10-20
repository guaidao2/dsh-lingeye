/**
 * dsh-lingeye — bundle root seat.
 *
 * The package root row exists for two reasons:
 *  - the Web client-modules scanner attributes the browser half to a row that
 *    names the package root, so the root must resolve to a module;
 *  - the host half of this row is inert: the store service and the preset
 *    tool surfaces live on their own subpath rows.
 * @module dsh-lingeye
 */

/** Host plugin body: no host-side behavior at the package root. */
export function apply() {}
