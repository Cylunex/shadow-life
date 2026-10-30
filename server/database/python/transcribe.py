"""Local-only bounded audio transcription; no user audio or text is written to disk."""
import argparse,io,json,sys
parser=argparse.ArgumentParser()
parser.add_argument('--model',required=True)
parser.add_argument('--language',default='zh')
parser.add_argument('--threads',type=int,default=2)
args=parser.parse_args()
raw=sys.stdin.buffer.read(10_000_001)
if not raw or len(raw)>10_000_000:raise SystemExit(2)
from faster_whisper import WhisperModel
model=WhisperModel(args.model,device='cpu',compute_type='int8',cpu_threads=args.threads,num_workers=1,local_files_only=True)
segments,_=model.transcribe(io.BytesIO(raw),language=args.language or None,beam_size=3,vad_filter=True,condition_on_previous_text=False)
result=[]
for segment in segments:
 if segment.text.strip():result.append({'start':segment.start,'end':segment.end,'text':segment.text.strip()})
 if len(result)>500:raise SystemExit(3)
sys.stdout.write(json.dumps({'segments':result},ensure_ascii=False))
