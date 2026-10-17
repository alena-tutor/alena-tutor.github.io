import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export async function verifyWebApp(url,{fetchPage=globalThis.fetch,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=5}={}){
  const target=new URL(url);
  if(target.origin!=='https://script.google.com'||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(target.pathname)||target.search||target.hash)throw Error('A Google web app URL without personal keys is required.');
  for(let attempt=0;attempt<attempts;attempt++){
    if(attempt)await pause(2000);
    try{
      const response=await fetchPage(target.href,{redirect:'follow',signal:AbortSignal.timeout(20000)});
      const body=await response.text(),destination=new URL(response.url||target.href);
      const googleApp=['script.google.com','script.googleusercontent.com'].includes(destination.hostname);
      if(response.ok&&googleApp&&body.includes('WordPet')&&!/Sorry, unable to open the file|Page Not Found|Не удалось открыть файл/i.test(body))return {status:response.status};
    }catch{}
  }
  throw Error('WordPet page did not open without a Google login. Deployment is not ready for pupils; inspect its web app settings.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const config=JSON.parse(process.env.WORDPET_CONFIG_JSON||'{}');
    const result=await verifyWebApp(config.webAppUrl);
    console.log('WordPet public page verified: HTTP '+result.status+'; no pupil or teacher key was used.');
    if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,'\nWordPet public page opened successfully without a Google login or a personal access key.\n');
  }catch{console.error('WordPet public page verification failed. Check the web app deployment settings before sharing links.');process.exitCode=1;}
}
