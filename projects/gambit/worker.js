importScripts('model.js?v=2');
onmessage=function(event){var data=event.data,g=new Gambit.Game(data.fen);if(data.keys)g.keys=data.keys;var result=Gambit.search(g,data.options,function(r){postMessage({kind:'depth',id:data.id,result:r});});postMessage({kind:'done',id:data.id,result:result});};
