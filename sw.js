/* Power × WS — Service Worker apenas para Web Push; sem cache de dados empresariais. */
const SCOPE=new URL(self.registration.scope);
const ICON=new URL('./assets/icon-192.png',SCOPE).href;
const BADGE=new URL('./assets/icon-192.png',SCOPE).href;
function allowedUrl(value){
  try{
    const url=new URL(value||'./',SCOPE);
    if(url.origin!==SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname))return SCOPE.href;
    const view=url.searchParams.get('view');
    if(!['dashboard','sales','settlements','reports'].includes(view||''))return SCOPE.href;
    return url.href;
  }catch{return SCOPE.href;}
}
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(self.clients.claim());});
self.addEventListener('push',event=>{
  let info={};
  try {info=event.data?event.data.json():{};} catch {info={};}
  const title=String(info.title||'Power × WS').slice(0,130);
  const body=String(info.body||'Você recebeu uma atualização').slice(0,350);
  event.waitUntil((async()=>{
    await self.registration.showNotification(title,{
      body,icon:ICON,badge:BADGE,
      tag:String(info.tag||'pbws-update').slice(0,120),
      data:{url:allowedUrl(info.url)},
      vibrate:[90,45,90]
    });
    if(self.registration.setAppBadge) await self.registration.setAppBadge().catch(()=>{});
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const destination=allowedUrl(event.notification.data?.url);
  const view=new URL(destination).searchParams.get('view')||'dashboard';
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      if(new URL(client.url).origin===SCOPE.origin &&
         new URL(client.url).pathname.startsWith(SCOPE.pathname)){
        await client.focus();
        client.postMessage({type:'pbws-notification-open',view});
        return;
      }
    }
    await self.clients.openWindow(destination);
  })());
});
