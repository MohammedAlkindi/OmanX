// router.js — Deterministic query router for OmanX
// Routes queries to "strict" (compliance) or "normal" (general) lanes

export const STRICT_TRIGGERS = [
  // Immigration/Visa (highest priority)
  'visa', 'f-1', 'f1', 'j-1', 'j1', 'i-20', 'i20', 'ds-2019', 'ds2019',
  'sevis', 'status', 'immigration', 'uscis', 'cbp', 'customs',
  
  // Work authorization
  'opt', 'cpt', 'stem', 'work authorization', 'employment', 'internship',
  'job', 'work permit', 'ead', 'off-campus', 'on-campus',
  
  // Legal/Compliance
  'legal', 'law', 'lawsuit', 'police', 'arrest', 'violation', 
  'deportation', 'removal', 'penalty', 'fine', 'compliance',
  
  // Medical/Health
  'insurance', 'medical', 'health', 'hospital', 'doctor', 'emergency',
  'ambulance', 'prescription', 'treatment', 'covid', 'vaccination',
  
  // Financial/Scholarship
  'scholarship', 'funding', 'stipend', 'tax', 'irs', 'w-2', '1099',
  'ssn', 'social security', 'ministry', 'reimbursement', 'payment',
  
  // Academic compliance
  'gpa', 'probation', 'dismissal', 'suspension', 'full-time',
  'course load', 'enrollment', 'registration', 'transcript',
  
  // Official procedures
  'dso', 'designated school official', 'oiss', 'international office',
  'form', 'application', 'petition', 'document', 'embassy', 'consulate',
  
  // Time-sensitive
  'deadline', 'expire', 'expiration', 'urgent', 'due date', 'asap',
  
  // Housing/Contract (legal implications)
  'lease', 'contract', 'rental agreement', 'eviction', 'landlord',
];

export const NORMAL_SIGNALS = [
  'restaurant', 'food', 'eat', 'cafe', 'coffee', 'pizza', 'brunch',
  'gym', 'grocery', 'supermarket', 'laundry', 'shopping',
  'philly', 'philadelphia', 'things to do', 'recommend', 'nearby',
  'weekend', 'fun', 'entertainment', 'movie', 'park', 'museum',
];

/**
 * Route query to strict or normal lane
 * @param {string} query - User's message
 * @returns {{ lane: 'strict' | 'normal', matches: string[], confidence: number }}
 */
export function routeQuery(query) {
  if (!query || typeof query !== 'string') {
    return { lane: 'normal', matches: [], confidence: 0 };
  }

  const q = query.toLowerCase().trim();
  
  // Check strict triggers (any match → strict)
  const strictMatches = STRICT_TRIGGERS.filter(trigger => 
    q.includes(trigger.toLowerCase())
  );
  
  if (strictMatches.length > 0) {
    return {
      lane: 'strict',
      matches: strictMatches,
      confidence: Math.min(strictMatches.length / 3, 1), // Cap at 1.0
    };
  }
  
  // Check normal signals
  const normalMatches = NORMAL_SIGNALS.filter(signal =>
    q.includes(signal.toLowerCase())
  );
  
  if (normalMatches.length > 0) {
    return {
      lane: 'normal',
      matches: normalMatches,
      confidence: Math.min(normalMatches.length / 2, 1),
    };
  }
  
  // Default: Ambiguous → strict (false-positive bias for safety)
  return {
    lane: 'strict',
    matches: [],
    confidence: 0.3,
  };
}

/**
 * Search knowledge base for relevant entries
 * @param {object} knowledgeJson - Parsed knowledge.json
 * @param {string} query - User query
 * @returns {Array} - Relevant KB entries with scores
 */
export function searchKnowledge(knowledgeJson, query) {
  if (!knowledgeJson || !query) return [];
  
  const q = query.toLowerCase();
  const results = [];
  
  // Handle array-based structure
  if (Array.isArray(knowledgeJson.documents)) {
    for (const doc of knowledgeJson.documents) {
      if (!doc || !doc.id) continue;
      
      let score = 0;
      const docText = JSON.stringify(doc).toLowerCase();
      
      // Score by keyword matches
      STRICT_TRIGGERS.forEach(trigger => {
        if (q.includes(trigger) && docText.includes(trigger)) {
          score += 2;
        }
      });
      
      // Score by title/summary match
      if (doc.title && q.includes(doc.title.toLowerCase())) score += 5;
      if (doc.summary && q.includes(doc.summary.toLowerCase())) score += 3;
      
      if (score > 0) {
        results.push({ doc, score, id: doc.id });
      }
    }
  } else {
    // Handle legacy object-based structure
    for (const [key, content] of Object.entries(knowledgeJson)) {
      if (key === 'metadata') continue;
      
      let score = 0;
      const contentText = JSON.stringify(content).toLowerCase();
      
      STRICT_TRIGGERS.forEach(trigger => {
        if (q.includes(trigger) && contentText.includes(trigger)) {
          score += 2;
        }
      });
      
      if (score > 0) {
        results.push({ doc: content, score, id: key });
      }
    }
  }
  
  // Sort by score descending
  return results.sort((a, b) => b.score - a.score);
}