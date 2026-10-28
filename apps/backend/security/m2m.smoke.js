'use strict';
// Dependency-free local smoke test; Jest and Cognito integration are separate.
const assert = require('node:assert/strict');
const {readConfig,createM2MAuth} = require('./m2m');
const config=readConfig({AUTH_COGNITO_USER_POOL_ID:'us-east-1_TEST',AUTH_M2M_CLIENT_IDS:'service-1',AUTH_READ_SCOPE:'encounters/read',AUTH_WRITE_SCOPE:'encounters/write'});
const token='abc.def.ghi';
const payload={token_use:'access',client_id:'service-1',scope:'encounters/read encounters/write'};
const create=(verifyToken)=>createM2MAuth({config,verifyToken});
function check(auth,method,path,head='Bearer '+token) {
  const req={method,path,get:()=>head}; const res={code:200,set(){return this},status(c){this.code=c;return this},json(x){this.body=x;return this}};
  let forwarded=0;
  return Promise.resolve(auth(req,res,()=>{forwarded+=1})).then(()=>({status:res.code,forwarded,principal:req.auth}));
}
(async()=>{
  const auth=create(async()=>payload);
  assert.deepEqual(await check(auth,'GET','/encounters').then(x=>[x.status,x.forwarded]),[200,1]);
  assert.equal((await check(auth,'POST','/encounters','')).status,401);
  assert.equal((await check(auth,'GET','/id')).forwarded,1);
  assert.equal((await check(create(async()=>({...payload,scope:'encounters/read'})),'POST','/encounters')).status,403);
  assert.equal((await check(create(async()=>({...payload,client_id:'bad'})),'GET','/encounters')).status,401);
  assert.equal((await check(create(async()=>{throw Error('expired')}),'GET','/encounters')).status,401);
  assert.equal((await check(create(async()=>({...payload,scope:'encounters/read'})),'GET','/id')).status,403);
  console.log('PASS: 7 M2M offline smoke assertions (mock verifier, no crypto/DB)');
})().catch(e=>{console.error(e);process.exitCode=1});
