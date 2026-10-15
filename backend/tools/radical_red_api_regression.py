#!/usr/bin/env python3
"""Exercise the real ASGI routes without creating edited saves or a server."""
import asyncio,io,sys,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'backend'))
import json
from urllib.parse import urlsplit
from main import app

class Response:
    def __init__(self,status,body):self.status_code=status;self.text=body.decode()
    def json(self):return json.loads(self.text)
class Client:
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    async def request(self,method,path,files=None):
        body=b'';headers=[]
        if files:
            name,data=files['file'];boundary='PUSERegressionBoundary'
            body=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()+data+f'\r\n--{boundary}--\r\n'.encode()
            headers=[(b'content-type',f'multipart/form-data; boundary={boundary}'.encode())]
        headers.append((b'content-length',str(len(body)).encode()))
        url=urlsplit(path);sent=False;messages=[]
        async def receive():
            nonlocal sent
            if sent:return {'type':'http.disconnect'}
            sent=True;return {'type':'http.request','body':body,'more_body':False}
        async def send(message):messages.append(message)
        scope={'type':'http','asgi':{'version':'3.0'},'http_version':'1.1','method':method,'scheme':'http','path':url.path,'raw_path':url.path.encode(),'query_string':url.query.encode(),'root_path':'','headers':headers,'client':('test',1),'server':('test',80)}
        await app(scope,receive,send)
        return Response(next(m['status'] for m in messages if m['type']=='http.response.start'),b''.join(m.get('body',b'') for m in messages if m['type']=='http.response.body'))
    async def get(self,path):return await self.request('GET',path)
    async def post(self,path,files=None):return await self.request('POST',path,files)

async def main():
    path=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'backend/local_artifacts/radicalred.sav'
    source=path.read_bytes()
    async with Client() as client:
        profiles=(await client.get('/profiles')).json();assert len(profiles)==2
        response=await client.post('/upload',files={'file':('fixture.sav',source)})
        assert response.status_code==409,response.text
        response=await client.post('/upload?profile_id=radical-red-4.1',files={'file':('fixture.sav',source)})
        assert response.status_code==200,response.text
        assert (await client.get('/profile')).json()['box_count']==25
        assert len((await client.get('/party')).json())==6
        assert (await client.get('/trainer')).json()['profile_id']=='radical-red-4.1'
        assert len((await client.get('/items')).json())==749
        assert (await client.get('/balls')).json()==[]
        for route in ['/bp','/game-progress','/pokedex/summary','/pc/box/26']:
            response=await client.get(route)
            assert response.status_code==400,(route,response.status_code,response.text)
        response=await client.get('/pc/load');assert response.status_code==200,response.text
        pockets=(await client.get('/bag/pockets/bootstrap')).json()['pockets']
        assert set(pockets)=={'main','key','ball','tm','berry'}
        for pocket in pockets.values():
            response=await client.get('/bag/pocket?anchor_offset='+str(pocket['anchor_offset']))
            assert response.status_code==200,response.text
        assert path.read_bytes()==source
    print('PASS: Radical Red recognition, explicit upload, profile/catalogs/readers and unsupported API guards')
if __name__=='__main__':asyncio.run(main())
