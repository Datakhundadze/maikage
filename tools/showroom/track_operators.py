import cv2, numpy as np, subprocess, json, os
S='/tmp/showroom-track/'
PART=64.998; FPS=10; SPAN=6.0
W,H=960,480
DESKS=[(8,0),(71,1.4),(150.2,2.2),(216.2,1.6)]
OPS={'boy':(-11.25,-14.4),'girl':(12.66,-14.4)}
def px(yaw,pitch): return np.array([(yaw/360+0.5)*W,(0.5-pitch/180)*H],np.float32)
def ang(p): return (float((p[0]/W-0.5)*360), float((0.5-p[1]/H)*180))
def frames(part,t0,t1):
    d=f'{S}trk/f{part}_{t0:.1f}'; os.makedirs(d,exist_ok=True)
    subprocess.run(['ffmpeg','-v','error','-y','-ss',f'{t0:.3f}','-i',f'{S}webm/p{part}-fwd.webm','-t',f'{t1-t0:.3f}','-vf',f'fps={FPS}',f'{d}/%04d.png'],check=True)
    fs=sorted(os.listdir(d)); return [cv2.imread(f'{d}/{f}',0) for f in fs]
out={}
for dt,yoff in DESKS:
    part=int(dt//PART); loc=dt-part*PART
    t0=max(0,loc-SPAN); t1=min(PART-0.05,loc+SPAN)
    fr=frames(part,t0,t1); k0=int(round((loc-t0)*FPS)); k0=min(k0,len(fr)-1)
    pts0={n:px(y+yoff,p) for n,(y,p) in OPS.items()}
    res={k0:{'pts':{n:v.copy() for n,v in pts0.items()},'s':1.0,'q':1.0}}
    # desk region: around the two seats
    cx=(pts0['boy'][0]+pts0['girl'][0])/2; cy=pts0['boy'][1]
    for step in (1,-1):
        pts={n:v.copy() for n,v in pts0.items()}; s=1.0; k=k0
        while 0<=k+step<len(fr):
            a=fr[k]; b=fr[k+step]
            c=(pts['boy']+pts['girl'])/2; half=np.array([70*max(s,0.6)+25,45*max(s,0.6)+20])
            x0,y0=np.maximum(c-half,0).astype(int); x1,y1=np.minimum(c+half,[W-1,H-1]).astype(int)
            if x1-x0<30 or y1-y0<20: break
            mask=np.zeros_like(a); mask[y0:y1,x0:x1]=255
            p0=cv2.goodFeaturesToTrack(a,120,0.01,4,mask=mask)
            if p0 is None or len(p0)<12: break
            p1,st,err=cv2.calcOpticalFlowPyrLK(a,b,p0,None,winSize=(21,21),maxLevel=3)
            g=st.ravel()==1
            if g.sum()<10: break
            M,inl=cv2.estimateAffinePartial2D(p0[g],p1[g],method=cv2.RANSAC,ransacReprojThreshold=2.0)
            if M is None: break
            q=float(inl.sum())/max(1,g.sum())
            ds=float(np.hypot(M[0,0],M[1,0]))
            if q<0.35 or not (0.85<ds<1.18): break
            for n in pts: pts[n]=(M[:,:2]@pts[n]+M[:,2]).astype(np.float32)
            s*=ds; k+=step
            if not (0.4<s<2.6): break
            if min(pts['boy'][0],pts['girl'][0])<20 or max(pts['boy'][0],pts['girl'][0])>W-20: break
            res[k]={'pts':{n:v.copy() for n,v in pts.items()},'s':s,'q':q}
    ks=sorted(res)
    rows=[]
    for k in ks:
        r=res[k]; by,bp=ang(r['pts']['boy']); gy,gp=ang(r['pts']['girl'])
        rows.append([round(t0+k/FPS+part*PART,2),round(by,2),round(bp,2),round(gy,2),round(gp,2),round(r['s'],3)])
    out[str(dt)]=rows
    print(dt,'frames',len(fr),'tracked',len(ks),'from',rows[0][0],'to',rows[-1][0],'scale',rows[0][5],rows[-1][5])
    # debug sheet
    tiles=[]
    for k in ks[::max(1,len(ks)//8)][:9]:
        im=cv2.cvtColor(fr[k],cv2.COLOR_GRAY2BGR); r=res[k]
        for n,col in (('boy',(0,255,0)),('girl',(0,0,255))):
            p=r['pts'][n]; hh=12*2.667*r['s']/2
            cv2.rectangle(im,(int(p[0]-hh*0.667),int(p[1]-hh)),(int(p[0]+hh*0.667),int(p[1]+hh)),col,1)
        c=((r['pts']['boy']+r['pts']['girl'])/2).astype(int)
        x0=int(np.clip(c[0]-160,0,W-320)); y0=int(np.clip(c[1]-110,0,H-220))
        tiles.append(im[y0:y0+220,x0:x0+320])
    cv2.imwrite(f'{S}trk/dbg_{dt}.jpg',np.hstack(tiles))
json.dump(out,open(S+'trk/track.json','w'))
