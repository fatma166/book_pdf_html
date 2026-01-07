// واجهة جافاسكربت للعمليات النصية البسيطة (خوارزميات محلية ومبسطة)

function getInput(){
  return document.getElementById('inputText').value.trim();
}

function setOutput(id, html){
  document.getElementById(id).innerHTML = html;
}

// قائمة كلمات توقف عربية بسيطة
const AR_STOPWORDS = new Set(["في","من","على","و","الى","إلى","عن","ما","هو","هي","أن","إن","كان","كانت","لم","لن","ذلك","هذا","هذه","هناك","كل","مع","بحسب","أو","لكن","لماذا","كيف","لم" ]);

function tokenizeArabic(text){
  return text
    .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\s\.,؛:!?\-"'()\[\]]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(w=>w.trim())
    .filter(Boolean);
}

function sentenceSplit(text){
  // ابسط تقسيم للجمل يعتمد على نقاط، فاصلة منقوطة، علامة استفهام
  return text.split(/(?<=[\.\!\?؛؟])/g).map(s=>s.trim()).filter(Boolean);
}

function wordFrequencies(words){
  const freq = {};
  for(const w of words){
    const lw = w.toLowerCase();
    if(AR_STOPWORDS.has(lw) || lw.length<2) continue;
    freq[lw] = (freq[lw]||0)+1;
  }
  return freq;
}

function scoreSentence(sentence, freq){
  const words = tokenizeArabic(sentence);
  let s = 0;
  for(const w of words){
    const lw = w.toLowerCase();
    if(freq[lw]) s += freq[lw];
  }
  return s;
}

function summarize(text, n=5){
  const sents = sentenceSplit(text);
  if(sents.length<=n) return sents;
  const words = tokenizeArabic(text);
  const freq = wordFrequencies(words);
  const scored = sents.map(s=>({s,score:scoreSentence(s,freq)}));
  scored.sort((a,b)=>b.score-a.score);
  return scored.slice(0,n).map(x=>x.s);
}

function doSummarize(){
  const text = getInput();
  if(!text){ setOutput('other','<i>أدخل النص أولاً</i>'); return; }
  const points = summarize(text,5);
  const html = '<ol>' + points.map(p=>'<li>'+escapeHtml(p)+'</li>').join('') + '</ol>';
  setOutput('other', html);
  setOutput('explanation', '<strong>تلخيص سطري:</strong><br>'+escapeHtml(points.join(' ')) );
}

function simplifyText(text){
  // خوارزمية بسيطة: قطع الجمل الطويلة عند الفواصل، اختصار العبارات الطويلة
  const sents = sentenceSplit(text);
  const out = [];
  for(const s of sents){
    // إذا كانت الجملة طويلة، قسمها عند الفواصل
    if(s.length>120){
      const parts = s.split(/[،,;:/]/).map(p=>p.trim()).filter(Boolean);
      for(const p of parts){
        out.push(p.length>0? ('• '+p) : '');
      }
    } else {
      out.push('• '+s);
    }
  }
  return out.join('\n');
}

function doSimplify(){
  const text = getInput();
  if(!text){ setOutput('explanation','<i>أدخل النص أولاً</i>'); return; }
  const simple = simplifyText(text);
  setOutput('explanation','<pre style="white-space:pre-wrap">'+escapeHtml(simple)+'</pre>');
  setOutput('other','<i>تم تبسيط الفقرة إلى نقاط قصيرة.</i>');
}

function doCompare(){
  const text = getInput();
  if(!text){ setOutput('other','<i>أدخل النص أولاً</i>'); return; }
  const a = prompt('ادخل المصطلح الأول (مثلاً: مفهوم A)');
  if(!a) return;
  const b = prompt('ادخل المصطلح الثاني للمقارنة (مثلاً: مفهوم B)');
  if(!b) return;
  const sents = sentenceSplit(text);
  const ctxA = sents.filter(s=>s.includes(a)).slice(0,4);
  const ctxB = sents.filter(s=>s.includes(b)).slice(0,4);
  let html = '<h4>سياقات "'+escapeHtml(a)+'"</h4>' + (ctxA.length? '<ul>'+ctxA.map(x=>'<li>'+escapeHtml(x)+'</li>').join('') +'</ul>' : '<i>لا توجد سياقات واضحة في النص.</i>');
  html += '<h4>سياقات "'+escapeHtml(b)+'"</h4>' + (ctxB.length? '<ul>'+ctxB.map(x=>'<li>'+escapeHtml(x)+'</li>').join('') +'</ul>' : '<i>لا توجد سياقات واضحة في النص.</i>');
  html += '<h4>مقترح للفرق</h4>' + '<p>بناءً على السياقات المقتطَفة، يمكن أن يكون الفرق:</p>' + '<ul><li>'+escapeHtml(a)+' مرتبط بـ '+escapeHtml(ctxA.join(' '))+'</li><li>'+escapeHtml(b)+' مرتبط بـ '+escapeHtml(ctxB.join(' '))+'</li></ul>';
  setOutput('other', html);
}

function doQuiz(){
  const text = getInput();
  if(!text){ setOutput('other','<i>أدخل النص أولاً</i>'); return; }
  const sents = sentenceSplit(text).filter(s=>s.length>20);
  const points = summarize(text, 10);
  const questions = points.map((p,i)=>('س'+(i+1)+': اشرح الجملة أو الفكرة التالية: "'+p+'"'));
  setOutput('other','<ol>'+questions.map(q=>'<li>'+escapeHtml(q)+'</li>').join('')+'</ol>');
  setOutput('explanation','<strong>ملاحظات للاختبار:</strong><br>يمكن تحويل كل سؤال إلى اختيار من متعدد أو سؤال مقالي بحسب الهدف.');
}

function doDefinitions(){
  const text = getInput();
  if(!text){ setOutput('other','<i>أدخل النص أولاً</i>'); return; }
  const sents = sentenceSplit(text);
  const defs = [];
  for(const s of sents){
    if(/يعني|هو|هي|تعرّف|تعني|يعرف|تُعرّف/.test(s)){
      defs.push(s);
    }
    // أيضاً احذف الجمل القصيرة التي قد تكون تعريفاً
    if(s.length<120 && /:/.test(s)) defs.push(s);
  }
  if(!defs.length) setOutput('other','<i>لم أعثر على تعاريف واضحة. حاول وضع عنوان أو جملة تعريفية.</i>');
  else setOutput('other','<ul>'+defs.map(d=>'<li>'+escapeHtml(d)+'</li>').join('')+'</ul>');
}

function doConceptMap(){
  const text = getInput();
  if(!text){ setOutput('diagram','<i>أدخل النص أولاً</i>'); return; }
  const words = tokenizeArabic(text).filter(w=>!AR_STOPWORDS.has(w.toLowerCase()));
  const freq = wordFrequencies(words);
  const keys = Object.keys(freq).sort((a,b)=>freq[b]-freq[a]).slice(0,6);
  const center = keys[0] || 'مفهوم'
  const nodes = keys.slice(1);

  // ابني SVG بسيط
  let svg = '<svg width="100%" height="220" viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg">';
  svg += '<defs><style>.t{font-family:Tahoma,Arial,sans-serif;font-size:14px;fill:#052a39}</style></defs>';
  svg += '<g transform="translate(300,110)">';
  svg += '<circle cx="0" cy="0" r="54" fill="#206bff" opacity="0.95" />';
  svg += '<text x="0" y="6" text-anchor="middle" class="t" fill="#fff">'+escapeXml(center)+'</text>';
  svg += '</g>';
  const angleStep = (Math.PI*2)/Math.max(1,nodes.length);
  for(let i=0;i<nodes.length;i++){
    const ang = -Math.PI/2 + i*angleStep;
    const x = 300 + Math.cos(ang)*160;
    const y = 110 + Math.sin(ang)*80;
    svg += '<line x1="300" y1="110" x2="'+x+'" y2="'+y+'" stroke="#bfe1ff" stroke-width="2" />';
    svg += '<g transform="translate('+x+','+y+')">';
    svg += '<circle cx="0" cy="0" r="40" fill="#fff" stroke="#bfe1ff" />';
    svg += '<text x="0" y="6" text-anchor="middle" class="t">'+escapeXml(nodes[i])+'</text>';
    svg += '</g>';
  }
  svg += '</svg>';
  setOutput('diagram', svg);
  setOutput('other','<i>خريطة مفاهيم مبدئية. يمكن تحسينها بخدمة تحليل لغوي متقدمة.</i>');
}

function doReview(){
  const text = getInput();
  if(!text){ setOutput('other','<i>أدخل النص أولاً</i>'); return; }
  const points = summarize(text,6);
  const html = '<h4>ملخص المراجعة:</h4><ul>' + points.map(p=>'<li>'+escapeHtml(p)+'</li>').join('') + '</ul>';
  setOutput('other', html);
  setOutput('explanation', '<strong>نص مختصر للمراجعة:</strong><br>' + escapeHtml(points.join(' ')));
}

function doExpected(){
  const text = getInput();
  if(!text){ setOutput('other','<i>أدخل النص أولاً</i>'); return; }
  const words = tokenizeArabic(text);
  const freq = wordFrequencies(words);
  const keys = Object.keys(freq).sort((a,b)=>freq[b]-freq[a]).slice(0,6);
  const questions = keys.map(k=> 'ضع سؤال يطلب تعريف أو تفسير عن: "'+k+'"');
  setOutput('other','<ol>'+questions.map(q=>'<li>'+escapeHtml(q)+'</li>').join('')+'</ol>');
}

// أدوات مساعدة للسلامة
function escapeHtml(s){
  return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');
}
function escapeXml(s){ return escapeHtml(s).replace(/\n/g,' ');}