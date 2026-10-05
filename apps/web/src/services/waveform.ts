export type Sample={time:number;value:number};
export type TimeWindow={start:number;end:number};
export function clampWindow(window:TimeWindow,full:TimeWindow):TimeWindow{
 const duration=full.end-full.start,span=Math.min(duration,Math.max(duration/10000,window.end-window.start)),start=Math.max(full.start,Math.min(full.end-span,window.start));return {start,end:start+span};
}
export function zoomWindow(window:TimeWindow,full:TimeWindow,factor:number,anchor=.5){const span=window.end-window.start,next=span*factor,start=window.start+(span-next)*anchor;return clampWindow({start,end:start+next},full);}
export function panWindow(window:TimeWindow,full:TimeWindow,delta:number){return clampWindow({start:window.start+delta,end:window.end+delta},full);}
function lowerBound(points:Sample[],time:number){let low=0,high=points.length;while(low<high){const mid=(low+high)>>>1;if(points[mid].time<time)low=mid+1;else high=mid;}return low;}
export function nearestSample(points:Sample[],time:number){const i=lowerBound(points,time);if(i===0)return points[0];if(i===points.length)return points.at(-1)!;return time-points[i-1].time<=points[i].time-time?points[i-1]:points[i];}
// Keep endpoints and min/max values in temporal order. No averaging changes readings.
export function displayEnvelope(points:Sample[],window:TimeWindow,bins=800):Sample[]{
 const from=Math.max(0,lowerBound(points,window.start)-1),to=Math.min(points.length,lowerBound(points,window.end)+1),step=Math.max(1,Math.ceil((to-from)/bins)),visible:Sample[]=[];
 for(let i=from;i<to;i+=step){const end=Math.min(to-1,i+step-1);let low=i,high=i;for(let j=i;j<=end;j++){if(points[j].value<points[low].value)low=j;if(points[j].value>points[high].value)high=j;}for(const index of [...new Set([i,low,high,end])].sort((a,b)=>a-b))visible.push(points[index]);}return visible;
}
