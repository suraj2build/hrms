/**
 * KnowledgeLayerService — centralized operational intelligence knowledge.
 * Provides explainability context, compliance knowledge, and operational patterns.
 * Sprint 5: In-memory store with built-in statutory knowledge entries.
 * Future: Persist to database + allow admin-managed entries.
 */
import type { KnowledgeEntry, KnowledgeDomain } from '../types/fabric-types.js'

const BUILT_IN_KNOWLEDGE: KnowledgeEntry[] = [
  {
    key: 'pf.threshold.2014', domain: 'compliance', title: 'PF Wage Ceiling',
    content: 'Employee Provident Fund contributions are mandatory for employees with basic wages up to ₹15,000/month. Employer must contribute 12% of basic wages. Employees earning above ₹15,000 may voluntarily continue.',
    tags: ['pf', 'statutory', 'india', 'wage_ceiling'], effective_from: '2014-09-01',
    source: 'EPF & MP Act, EPFO circular Sep 2014',
  },
  {
    key: 'esi.threshold.2017', domain: 'compliance', title: 'ESI Gross Wage Ceiling',
    content: 'Employees with gross wages up to ₹21,000/month are covered under ESI. Employee contribution: 0.75% of gross wages. Employer contribution: 3.25% of gross wages.',
    tags: ['esi', 'statutory', 'india'], effective_from: '2017-01-01',
    source: 'ESI (Amendment) Act 2010, ESIC notification 2017',
  },
  {
    key: 'overtime.weekly_limit', domain: 'compliance', title: 'Weekly Overtime Limit',
    content: 'Under the Factories Act 1948, an employee may not work more than 48 hours per week. Overtime beyond this must be paid at double the ordinary rate. Excessive overtime is a compliance risk.',
    tags: ['overtime', 'factories_act', 'india'], effective_from: '2024-01-01',
  },
  {
    key: 'governance.drift.explanation', domain: 'governance', title: 'What is Governance Drift?',
    content: 'Governance drift occurs when operational patterns gradually deviate from established policies. Examples include growing override frequency, approval bypass patterns, or escalating regularization rates.',
    tags: ['drift', 'governance', 'policy'], effective_from: '2024-01-01',
  },
  {
    key: 'trust.score.explanation', domain: 'trust', title: 'Trust Score Methodology',
    content: 'Employee trust scores (0–100) are computed from identity verification results, duplicate detection outcomes, and document completeness. Scores below 60 indicate high risk requiring HR review.',
    tags: ['trust', 'scoring', 'methodology'], effective_from: '2024-01-01',
  },
  {
    key: 'composite.risk.explanation', domain: 'operations', title: 'Composite Risk Score',
    content: 'Composite risk (0–100) combines governance risk (25%), trust risk (25%), operational health risk (30%), and security risk (20%). Scores above 75 require immediate review.',
    tags: ['risk', 'composite', 'scoring'], effective_from: '2024-01-01',
  },
]

export class KnowledgeLayerService {
  private entries: KnowledgeEntry[] = [...BUILT_IN_KNOWLEDGE]

  /** Register a new knowledge entry. */
  register(entry: KnowledgeEntry): void { this.entries.push(entry) }

  /** Get a knowledge entry by key. */
  get(key: string): KnowledgeEntry | undefined {
    return this.entries.find(e => e.key === key)
  }

  /** Search knowledge entries by domain or tags. */
  search(query: { domain?: KnowledgeDomain; tags?: string[]; text?: string }): KnowledgeEntry[] {
    return this.entries.filter(e => {
      if (query.domain && e.domain !== query.domain) return false
      if (query.tags && !query.tags.some(t => e.tags.includes(t))) return false
      if (query.text) {
        const lower = query.text.toLowerCase()
        return e.title.toLowerCase().includes(lower) || e.content.toLowerCase().includes(lower)
      }
      return true
    })
  }

  /** List all entries for a domain. */
  getByDomain(domain: KnowledgeDomain): KnowledgeEntry[] {
    return this.entries.filter(e => e.domain === domain)
  }

  listAll(): KnowledgeEntry[] { return [...this.entries] }
}

export const knowledgeLayerService = new KnowledgeLayerService()
