'use strict';
// Exercises the real Express app mounting order with stubbed business routers.
// A separate disposable-PostgreSQL end-to-end suite remains required.

jest.mock('./../routes/health', () => {
  const { Router } = require('express');
  const r = Router(); r.get('/health', (req,res)=>res.json({status:'probe'}));return r;
});
jest.mock('./../routes/adt', () => {
  const { Router } = require('express');
  const r = Router(); r.post('/from-adt',(req,res)=>res.status(201).json({synthetic:true}));return r;
});
jest.mock('./../routes/encounters', () => {
  const { Router } = require('express');
  const r = Router(); r.get('/',(req,res)=>res.json({encounters:[]}));r.post('/',(req,res)=>res.status(201).json({synthetic:true}));return r;
});
jest.mock('aws-jwt-verify',()=>({
  CognitoJwtVerifier:{create:()=>({verify:async token=>{
    if(token==='reader.payload.sig')return {token_use:'access',client_id:'service-test',scope:'encounters/read'};
    if(token==='writer.payload.sig')return {token_use:'access',client_id:'service-test',scope:'encounters/read encounters/write'};
    throw Error('invalid signature');
  }})}
}));

let server, base;
beforeAll(async()=>{
  process.env.AUTH_COGNITO_USER_POOL_ID='us-east-1_TEST';
  process.env.AUTH_M2M_CLIENT_IDS='service-test';
  process.env.AUTH_READ_SCOPE='encounters/read';
  process.env.AUTH_WRITE_SCOPE='encounters/write';
  const app=require('../app');
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
  base=`http://127.0.0.1:${server.address().port}`;
});
afterAll(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  for(const k of ['AUTH_COGNITO_USER_POOL_ID','AUTH_M2M_CLIENT_IDS','AUTH_READ_SCOPE','AUTH_WRITE_SCOPE'])delete process.env[k];
});
const headers=token=>token?{authorization:`Bearer ${token}`}:{};

test('health probe remains outside authenticated encounter API',async()=>{
  const r=await fetch(`${base}/health`);expect(r.status).toBe(200);
});
test.each([['GET','/api/encounters'],['POST','/api/encounters/from-adt'],['GET','/api/id']])('%s %s denies missing token',async(method,path)=>{
  const r=await fetch(base+path,{method});expect(r.status).toBe(401);
});
test('read client reads but cannot submit ADT',async()=>{
  expect((await fetch(`${base}/api/encounters`,{headers:headers('reader.payload.sig')})).status).toBe(200);
  expect((await fetch(`${base}/api/encounters/from-adt`,{method:'POST',headers:headers('reader.payload.sig')})).status).toBe(403);
});
test('write client submits synthetic ADT to stubbed handler',async()=>{
  const r=await fetch(`${base}/api/encounters/from-adt`,{method:'POST',headers:headers('writer.payload.sig')});
  expect(r.status).toBe(201);
});
test('GET /api/id requires write scope',async()=>{
  expect((await fetch(`${base}/api/id`,{headers:headers('reader.payload.sig')})).status).toBe(403);
});
test('malformed token is denied before route handling',async()=>{
  const r=await fetch(`${base}/api/encounters`,{headers:headers('broken')});expect(r.status).toBe(401);
});
