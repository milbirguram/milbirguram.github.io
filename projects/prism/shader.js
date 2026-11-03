// Original GLSL translation of model.js. Accumulation stores linear radiance.
var PrismShader = {
vertex: '#version 300 es\nprecision highp float;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}',
fragment: `#version 300 es
precision highp float; precision highp int;
uniform sampler2D previous;uniform ivec2 size;uniform int sampleIndex;uniform int maxBounces;uniform ivec3 materials;uniform bool dof;out vec4 outputColour;
uint state;float randomFloat(){state^=state<<13;state^=state>>17;state^=state<<5;return float(state)/4294967296.;}
vec3 randomUnit(){float z=2.*randomFloat()-1.;float a=6.28318530718*randomFloat();float r=sqrt(max(0.,1.-z*z));return vec3(r*cos(a),r*sin(a),z);}
float schlick(float c,float eta){float r=(1.-eta)/(1.+eta);r*=r;return r+(1.-r)*pow(1.-c,5.);}
vec3 centre(int i){if(i==0)return vec3(0,-100.5,-1);if(i==1)return vec3(0,0,-1);if(i==2)return vec3(-1.08,0,-1.12);return vec3(1.08,0,-1.03);}
vec3 albedo(int i){if(i==0)return vec3(.56,.6,.5);if(i==1)return vec3(.92,.96,1);if(i==2)return vec3(.63,.18,.1);return vec3(.8,.8,.85);}
float fuzz(int i){if(i==1)return .06;if(i==2)return .08;return .12;}
vec3 radiance(vec3 origin,vec3 direction){vec3 throughput=vec3(1);for(int bounce=0;bounce<16;bounce++){if(bounce>=maxBounces)break;float closest=1.e20;int hitId=-1;vec3 point,normal;bool front=false;
for(int i=0;i<4;i++){vec3 oc=origin-centre(i);float radius=i==0?100.:.5;float a=dot(direction,direction),b=dot(oc,direction),c=dot(oc,oc)-radius*radius,disc=b*b-a*c;if(disc<0.)continue;float t=(-b-sqrt(disc))/a;if(t<.001)t=(-b+sqrt(disc))/a;if(t<.001||t>=closest)continue;closest=t;hitId=i;point=origin+t*direction;vec3 outward=(point-centre(i))/radius;front=dot(direction,outward)<0.;normal=front?outward:-outward;}
if(hitId<0){float t=.5*(direction.y+1.);return throughput*mix(vec3(1),vec3(.5,.7,1),t);}int mat=hitId==0?0:materials[hitId-1];vec3 next;
if(mat==0){next=normal+randomUnit();if(dot(next,next)<1.e-12)next=normal;next=normalize(next);throughput*=albedo(hitId);}else if(mat==1){next=normalize(reflect(direction,normal)+fuzz(hitId)*randomUnit());throughput*=albedo(hitId);if(dot(next,normal)<=0.)return vec3(0);}else{float eta=front?1./1.5:1.5,c=min(dot(-direction,normal),1.);vec3 perp=eta*(direction+c*normal);float q=1.-dot(perp,perp);if(q<0.)next=reflect(direction,normal);else if(schlick(c,eta)>randomFloat())next=reflect(direction,normal);else next=perp-sqrt(q)*normal;}
origin=point;direction=normalize(next);}return vec3(0);}
void main(){ivec2 p=ivec2(gl_FragCoord.xy);int y=size.y-1-p.y;state=uint((y*size.x+p.x+1)*1973+(sampleIndex+1)*9277);if(state==0u)state=1u;float u=(float(p.x)+randomFloat())/float(size.x);float v=1.-(float(y)+randomFloat())/float(size.y);vec3 origin=vec3(3,1.7,3.7),target=vec3(0,0,-1),w=normalize(origin-target),right=normalize(cross(vec3(0,1,0),w)),up=cross(w,right);float focus=length(origin-target),hh=tan(radians(23.)/2.);vec3 dir=-focus*w+(2.*u-1.)*hh*float(size.x)/float(size.y)*focus*right+(2.*v-1.)*hh*focus*up;float a=6.28318530718*randomFloat(),r=sqrt(randomFloat())*(dof?.045:0.);vec3 offset=r*cos(a)*right+r*sin(a)*up;vec3 colour=radiance(origin+offset,normalize(dir-offset));vec3 old=sampleIndex==0?vec3(0):texelFetch(previous,p,0).rgb;outputColour=vec4((old*float(sampleIndex)+colour)/float(sampleIndex+1),1);}`,
display:`#version 300 es
precision highp float;uniform sampler2D image;uniform vec2 size;out vec4 colour;void main(){vec3 c=texture(image,gl_FragCoord.xy/size).rgb;colour=vec4(sqrt(clamp(c,0.,1.)),1);}`
};
