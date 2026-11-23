# Lifts the hall in the street clip to the walk footage's exposure and colour, so the
# door opens onto the same showroom the walk then shows (David 2026-11-23).
import cv2, numpy as np, subprocess, sys
src, dst, walk = sys.argv[1], sys.argv[2], sys.argv[3]
T_A, T_B = 6.45, 7.05           # ramp: door starts to open → hall fills the frame
def persp(fr, W, H, hfov):
    SH,SW=fr.shape[:2]; f=(W/2)/np.tan(np.radians(hfov)/2)
    xs,ys=np.meshgrid(np.arange(W)-W/2+0.5,np.arange(H)-H/2+0.5)
    d=np.stack([xs,-ys,np.full_like(xs,f)],-1); d/=np.linalg.norm(d,axis=-1,keepdims=True)
    lon=np.arctan2(d[...,0],d[...,2]); lat=np.arcsin(np.clip(d[...,1],-1,1))
    mx=((lon/(2*np.pi)+0.5)*SW).astype(np.float32); my=((0.5-lat/np.pi)*SH).astype(np.float32)
    return cv2.remap(fr,mx,my,cv2.INTER_LINEAR,borderMode=cv2.BORDER_WRAP)
cap=cv2.VideoCapture(src); fps=cap.get(5); W=int(cap.get(3)); H=int(cap.get(4))
frames=[]
while True:
    ok,f=cap.read()
    if not ok: break
    frames.append(f)
ref=frames[min(len(frames)-1,int(7.3*fps))]
tgt=persp(cv2.imread(walk), W, H, 100 if W>H else 68)
def stats(im):
    lab=cv2.cvtColor(im,cv2.COLOR_BGR2LAB).astype(np.float32).reshape(-1,3)
    return lab.mean(0), lab.std(0)
m0,s0=stats(ref); m1,s1=stats(tgt)
gain=np.clip(s1/np.maximum(s0,1e-3),0.6,1.9)
enc=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{W}x{H}','-r',str(fps),'-i','-','-c:v','libx264','-preset','slow','-crf','24','-pix_fmt','yuv420p','-movflags','+faststart','-an',dst],stdin=subprocess.PIPE)
for i,f in enumerate(frames):
    t=i/fps; w=float(np.clip((t-T_A)/(T_B-T_A),0,1)); w=w*w*(3-2*w)
    if w>0:
        lab=cv2.cvtColor(f,cv2.COLOR_BGR2LAB).astype(np.float32)
        g=(lab-m0)*gain+m1
        lab=np.clip(lab*(1-w)+g*w,0,255).astype(np.uint8)
        f=cv2.cvtColor(lab,cv2.COLOR_LAB2BGR)
        if w>0.3: f=cv2.bilateralFilter(f,5,18*w,5)   # the lifted shadows are noisy
    enc.stdin.write(f.tobytes())
enc.stdin.close(); enc.wait()
