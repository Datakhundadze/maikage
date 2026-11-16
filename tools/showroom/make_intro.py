# Cuts the street-to-hall part of the 360° entrance footage and re-projects it into an
# ordinary forward-looking clip (portrait + landscape) for the showroom intro
# (public/tour/intro/). Source: export_video.MP4 (David, 2026-11-16), 3840x1920, 30 s.
# The view follows the door: KEY = (second, yaw) read off frame grids by eye.
# Run next to the source saved as entry.mp4:  python3 make_intro.py
import subprocess, sys, numpy as np, cv2
SRC='entry.mp4'; T0,T1=11.5,29.8; SPEED=1.8; FPS=30
KEY=[(10,-15),(12,-20),(14,-30),(16,-10),(18,-25),(19,-39),(20,-42),(21,-51),(22,-56),(23,-48),(24,-45),(25,-80),(26,-85),(27,-70),(28,-62),(29,-55),(30,-60)]
PK=[(10,-2),(22,-2),(24,-6),(30,-10)]
SW,SH=2880,1440
def yaw_at(t):
    return np.interp(t,[k[0] for k in KEY],[k[1] for k in KEY])
def run(name,W,H,hfov):
    n_src=int((T1-T0)*30000/1001)
    idx=np.arange(0,n_src,SPEED).astype(int)
    ts=T0+idx*1001/30000
    yaws=np.array([yaw_at(t) for t in ts]); k=np.exp(-np.linspace(-2,2,41)**2); k/=k.sum()
    yaws=np.convolve(np.pad(yaws,20,mode='edge'),k,mode='valid')
    pit=np.interp(ts,[p[0] for p in PK],[p[1] for p in PK])
    f=(W/2)/np.tan(np.radians(hfov)/2)
    xs,ys=np.meshgrid(np.arange(W)-W/2+0.5,np.arange(H)-H/2+0.5)
    d=np.stack([xs,-ys,np.full_like(xs,f)],-1); d/=np.linalg.norm(d,axis=-1,keepdims=True)
    dec=subprocess.Popen(['ffmpeg','-v','error','-ss',str(T0),'-t',str(T1-T0),'-i',SRC,'-vf',f'scale={SW}:{SH}','-f','rawvideo','-pix_fmt','bgr24','-'],stdout=subprocess.PIPE)
    enc=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-c:v','libx264','-preset','slow','-crf','27','-pix_fmt','yuv420p','-movflags','+faststart','-an',name],stdin=subprocess.PIPE)
    want=set(idx.tolist()); order={v:i for i,v in enumerate(idx.tolist())}
    i=0
    while True:
        buf=dec.stdout.read(SW*SH*3)
        if len(buf)<SW*SH*3: break
        if i in want:
            j=order[i]; fr=np.frombuffer(buf,np.uint8).reshape(SH,SW,3)
            y=np.radians(yaws[j]); p=np.radians(pit[j])
            Rx=np.array([[1,0,0],[0,np.cos(p),np.sin(p)],[0,-np.sin(p),np.cos(p)]])
            Ry=np.array([[np.cos(y),0,np.sin(y)],[0,1,0],[-np.sin(y),0,np.cos(y)]])
            v=d@(Ry@Rx).T
            lon=np.arctan2(v[...,0],v[...,2]); lat=np.arcsin(np.clip(v[...,1],-1,1))
            mx=((lon/(2*np.pi)+0.5)*SW).astype(np.float32); my=((0.5-lat/np.pi)*SH).astype(np.float32)
            out=cv2.remap(fr,mx,my,cv2.INTER_LINEAR,borderMode=cv2.BORDER_WRAP)
            enc.stdin.write(out.tobytes())
        i+=1
    enc.stdin.close(); enc.wait(); dec.wait()
run('intro-portrait.mp4',720,1280,68)
run('intro-landscape.mp4',1280,720,100)
