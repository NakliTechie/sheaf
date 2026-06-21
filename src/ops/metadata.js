// ops/metadata.js — document metadata (pdf-lib). View is a non-mutating artifact;
// edit mutates the info dict in place. Only the fields the caller supplies are
// touched — omitted fields are left exactly as they were.

export const ops = [
  {
    id: 'metadata.set', label: 'Edit metadata', group: 'metadata', icon: 'info',
    description: 'Set document metadata. Only the provided fields are changed; omit a field to leave it untouched. keywords is a comma-or-array list.',
    agentCallable: true,
    params: {
      title:    { type: 'string', maxLength: 2000 },
      author:   { type: 'string', maxLength: 2000 },
      subject:  { type: 'string', maxLength: 2000 },
      keywords: { type: 'any' },
      creator:  { type: 'string', maxLength: 2000 },
      producer: { type: 'string', maxLength: 2000 },
    },
    run(doc, p) {
      const pdf = doc.pdf;
      if (p.title    !== undefined) pdf.setTitle(p.title);
      if (p.author   !== undefined) pdf.setAuthor(p.author);
      if (p.subject  !== undefined) pdf.setSubject(p.subject);
      if (p.creator  !== undefined) pdf.setCreator(p.creator);
      if (p.producer !== undefined) pdf.setProducer(p.producer);
      if (p.keywords !== undefined) {
        const kw = Array.isArray(p.keywords)
          ? p.keywords
          : String(p.keywords).split(',').map(s => s.trim()).filter(Boolean);
        pdf.setKeywords(kw);
      }
      return { doc };
    },
  },

  {
    id: 'metadata.get', label: 'View metadata', group: 'metadata', icon: 'info',
    description: 'Return the document metadata as an object. Does not change the document.',
    agentCallable: true, mutates: false,
    params: {},
    run(doc) { return { artifact: doc.getMetadata() }; },
  },
];
