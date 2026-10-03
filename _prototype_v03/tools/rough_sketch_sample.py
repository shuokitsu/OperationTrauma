import numpy as np, struct, sys
sp=sys.argv[1]
def rbmp(p):
    d=open(p,'rb').read(); off=struct.unpack_from('<I',d,10)[0]; w,h=struct.unpack_from('<ii',d,18)
    row=(w*3+3)//4*4; a=np.frombuffer(d,np.uint8,offset=off,count=row*abs(h)).reshape(abs(h),row)[:,:w*3].reshape(abs(h),w,3)
    a=a[::-1] if h>0 else a; return a[...,::-1].astype(np.float32)
def wbmp(p,a):
    a=np.clip(a,0,255).astype(np.uint8)[::-1,:,::-1]; h,w,_=a.shape; row=(w*3+3)//4*4
    buf=np.zeros((h,row),np.uint8); buf[:,:w*3]=a.reshape(h,w*3)
    hdr=b'BM'+struct.pack('<IHHI',54+buf.size,0,0,54)+struct.pack('<IiiHHIIiiII',40,w,h,1,24,0,buf.size,2835,2835,0,0)
    open(p,'wb').write(hdr+buf.tobytes())
def blur(x,s):
    r=int(s*3)+1; k=np.exp(-np.arange(-r,r+1)**2/(2*s*s)); k/=k.sum()
    pad=lambda a,ax: np.pad(a,[(r,r) if i==ax else (0,0) for i in range(a.ndim)],mode='edge')
    y=pad(x,1); x=sum(k[i]*y[:,i:i+x.shape[1]] for i in range(2*r+1))
    y=pad(x,0); return sum(k[i]*y[i:i+x.shape[0]] for i in range(2*r+1))
src=rbmp(sp+'/src.bmp')
gray=src@np.array([.299,.587,.114],np.float32)
g=blur(gray,1.3)                      # 細かいハッチングを弱める
inv=blur(255-g,2.2)
sk=np.clip(g*255/np.maximum(255-inv,1),0,255)   # 鉛筆風の線（覆い焼き）
sk=255*(sk/255)**1.5                  # 線を少し濃く、薄い線は消す
sk=np.clip((sk-40)*255/215,0,255)
col=np.stack([blur(src[...,c],2.5) for c in range(3)],-1)
lum=col.mean(-1,keepdims=True); col=lum+(col-lum)*0.8   # 彩度を少し落とす
col=col*0.5+255*0.5
yy,xx=np.mgrid[0:src.shape[0],0:src.shape[1]]
m=np.clip(1-(((xx-152)/42)**2+((yy-108)/26)**2),0,1)**0.7
col=col+(255-col)*0.55*m[...,None]
sk=sk+(255-sk)*0.45*m                  # 淡い水彩風に明るく
out=col*(sk[...,None]/255)
wbmp(sp+'/rough.bmp',out)
cmp=np.full((src.shape[0],src.shape[1]*2+20,3),255,np.float32); cmp[:,:src.shape[1]]=src; cmp[:,src.shape[1]+20:]=out
wbmp(sp+'/compare.bmp',cmp)
