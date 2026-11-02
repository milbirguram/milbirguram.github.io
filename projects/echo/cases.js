// Echo: case files. Documented incidents come from Wikipedia's "List of citogenesis incidents";
// controls are sentences whose cited source is far older than the sentence. Each is pinned to a
// revision (oldid) so the analysis is reproducible. `expect`: 'echo' must be flagged as a
// possible echo; 'clean' must not be.
//
// Two incident sentences were reworded before the citation was attached. Traced whole, Echo
// finds only the new wording and answers "Can't tell", pointing to the earlier wording. For those
// the case file traces the shared words Echo itself suggests (`trace`), and the check also runs
// the whole sentence (`wholeMustNot`), which must never come out "Source came first".
(function (root) {
  var CASES = [
    {
      id: 'vulfpeck',
      kind: 'documented',
      label: 'Vulfpeck: the German literature class',
      title: 'Vulfpeck',
      oldid: 563021596,
      pick: 'German literature class',
      trace: null,
      expect: 'echo',
      story: 'The band’s founder wrote the article in January 2013, saying the members met in a German literature class. Billboard repeated it in June 2013, and Billboard was then cited for it.'
    },
    {
      id: 'omonia',
      kind: 'documented',
      label: 'AC Omonia: “the Zany Ones”',
      title: 'AC Omonia',
      oldid: 239656275,
      pick: 'Zany Ones',
      trace: 'fans Zany Ones',
      wholeMustNot: 'first',
      expect: 'echo',
      story: 'In August 2008 an anonymous edit said a group of Omonia fans were called “the Zany Ones”. A Daily Mirror match preview repeated it in September, and the preview was cited for it the next day, in a reworded sentence. Traced whole, that sentence gives “Can’t tell” and points to the earlier wording, so this case traces the shared words Echo suggests.'
    },
    {
      id: 'mottainai',
      kind: 'documented',
      label: 'Mottainai: the Genpei Jōsuiki story',
      title: 'Mottainai',
      oldid: 925482674,
      pick: 'One of the earliest appearances',
      trace: null,
      expect: 'echo',
      story: 'A 2008 edit placed an early use of “mottainai” in the Genpei Jōsuiki. A 2015 book repeated it; the claim was removed in 2018 and restored in 2019 citing that book.'
    },
    {
      id: 'meighen-osgoode',
      kind: 'documented',
      label: 'Arthur Meighen: Osgoode Hall',
      title: 'Arthur Meighen',
      oldid: 1061264562,
      pick: 'Osgoode Law School',
      trace: 'law Osgoode School',
      wholeMustNot: 'first',
      expect: 'echo',
      story: 'Since 2008 the article had said Meighen went to Osgoode Hall Law School. In December 2021 an editor cited a 2012 newspaper tribute that said the same, in a newly worded sentence. Traced whole, that sentence gives “Can’t tell” and points to the 2008 wording, so this case traces the shared words Echo suggests.'
    },
    {
      id: 'meighen',
      kind: 'control',
      label: 'Control: Arthur Meighen’s wit',
      title: 'Arthur Meighen',
      oldid: 1061122821,
      pick: 'renowned for his sharp wit',
      trace: null,
      expect: 'clean',
      story: 'A sentence cited to Bruce Hutchison’s 1952 book The Incredible Canadian. The book is decades older than Wikipedia.'
    },
    {
      id: 'turnspit',
      kind: 'control',
      label: 'Control: the turnspit dog in 1576',
      title: 'Turnspit dog',
      oldid: 1380954886,
      pick: 'Of English Dogs in 1576',
      trace: null,
      expect: 'clean',
      story: 'A sentence cited to John Caius’s Of English Dogs (1576). The same article is the home of a real citogenesis case, “Vernepator Cur”, but this sentence is not one.'
    }
  ];

  // Every run the check makes: each case as its file sets it up, and, where the case traces
  // shorter words, the whole sentence too.
  function runs() {
    var out = [];
    CASES.forEach(function (c) {
      out.push({ id: c.id, caseId: c.id, label: c.label, trace: c.trace, expect: c.expect });
      if (c.wholeMustNot) out.push({ id: c.id + ':whole', caseId: c.id, label: c.label + ' (whole sentence)', trace: null, expect: 'not-' + c.wholeMustNot });
    });
    return out;
  }
  function passes(expect, code) {
    if (expect === 'echo') return code === 'echo';
    if (expect === 'clean') return code !== 'echo';
    if (/^not-/.test(expect)) return code !== expect.slice(4);
    return false;
  }

  var api = { CASES: CASES, runs: runs, passes: passes };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EchoCases = api;
})(this);
