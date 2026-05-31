/**
 * Fabric — enterprise orchestration fabric.
 * Sprint 5: Intelligence composition, federation, simulation, decision graph,
 * workflow orchestration, replay, knowledge, and control plane.
 *
 * NOTE: Exports only fabric-native types and services.
 * Does NOT re-export platform/operations or platform/observability to avoid name collisions.
 */
export * from './types/index.js'
export * from './composition/index.js'
export * from './federation/index.js'
export * from './simulation-engine/index.js'
export * from './decision-graph/index.js'
export * from './orchestration/index.js'
export * from './replay/index.js'
export * from './knowledge/index.js'
export * from './control-plane/index.js'
