import cv2, numpy as np, sys
from PIL import Image
S='/tmp/'
def mask_for(img, rect, fg_rect):
    m=np.full(img.shape[:2],cv2.GC_BGD,np.uint8)
    x0,y0,x1,y1=rect; m[y0:y1,x0:x1]=cv2.GC_PR_BGD
    # the garment's own colour model: start from pixels close to the colour in the sure-fg box
    fx0,fy0,fx1,fy1=fg_rect
    lab=cv2.cvtColor(img,cv2.COLOR_BGR2LAB).astype(np.float32)
    ref=np.median(lab[fy0:fy1,fx0:fx1].reshape(-1,3),axis=0)
    d=np.linalg.norm(lab-ref,axis=2)
    inner=np.zeros_like(m,bool); inner[y0:y1,x0:x1]=True
    m[(d<22)&inner]=cv2.GC_PR_FGD
    m[fy0:fy1,fx0:fx1]=cv2.GC_FGD
    bg=np.zeros((1,65),np.float64); fg=np.zeros((1,65),np.float64)
    cv2.grabCut(img,m,None,bg,fg,6,cv2.GC_INIT_WITH_MASK)
    out=((m==cv2.GC_FGD)|(m==cv2.GC_PR_FGD)).astype(np.uint8)
    # keep the component holding the sure-fg box, fill holes, smooth
    n,lbl=cv2.connectedComponents(out)
    keep=lbl[(fy0+fy1)//2,(fx0+fx1)//2]
    out=(lbl==keep).astype(np.uint8)
    out=cv2.morphologyEx(out,cv2.MORPH_CLOSE,np.ones((9,9),np.uint8))
    ff=out.copy(); h,w=ff.shape; cv2.floodFill(ff,np.zeros((h+2,w+2),np.uint8),(0,0),1)
    out=out|(1-ff)
    out=cv2.morphologyEx(out,cv2.MORPH_OPEN,np.ones((7,7),np.uint8))
    return cv2.GaussianBlur((out*255).astype(np.uint8),(0,0),1.2)
def shade_for(img, mask):
    l=cv2.cvtColor(img,cv2.COLOR_BGR2GRAY).astype(np.float32)
    inside=mask>200
    p90=np.percentile(l[inside],90); p50=np.percentile(l[inside],50)
    dark = p50<110
    if not dark:
        s=np.clip(l/p90,0,1.15)
    else:
        # dark cloth: relative shading is large and noisy — denoise, then compress
        ld=cv2.bilateralFilter(l,9,18,7)
        r=np.clip(ld/max(p90,1),0.05,1.6)
        s=np.clip(r**0.42,0,1.15)
        # keep the mid level like a white garment's (median ~0.93)
        s=np.clip(s*(0.93/np.median(s[inside])),0,1.15)
    return s, dark
if __name__=='__main__':
    cfg={'giordano':((120,330,1080,1480),(420,620,780,1200)),'washed-tee':((130,300,1090,1480),(420,620,780,1200)),'gildan-hoodie':((120,180,1090,1500),(430,520,770,900))}
    cols={'white':(245,245,243),'red':(200,30,40),'blue':(40,90,200),'beige':(215,195,165)}
    tiles=[]
    for n,(rect,fgr) in cfg.items():
        img=cv2.imread(f'public/tour/racks/{n}.webp')
        m=mask_for(img,rect,fgr); cv2.imwrite(S+f'{n}-mask.png',m)
        s,dark=shade_for(img,m); print(n,'dark' if dark else 'light', m.mean()/255)
        a=(m.astype(np.float32)/255)[...,None]
        ov=img.copy(); ov[...,1]=np.clip(ov[...,1]+90*a[...,0],0,255)
        tiles.append(ov)
        for cn,c in cols.items():
            col=np.array(c[::-1],np.float32)[None,None,:]*s[...,None]
            tiles.append(np.clip(img*(1-a)+col*a,0,255).astype(np.uint8))
    rows=[np.hstack([cv2.resize(t,(360,450)) for t in tiles[i*5:(i+1)*5]]) for i in range(3)]
    cv2.imwrite(S+'proto.jpg',np.vstack(rows),[cv2.IMWRITE_JPEG_QUALITY,85])
