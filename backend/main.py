from fastapi import FastAPI, HTTPException, status, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from transformers import AutoTokenizer, AutoModelForCausalLM
import torch
import psutil
from datetime import datetime
from typing import Optional
from typing import List


from .firebase_client import db, firebase_auth
from firebase_admin import firestore

app = FastAPI(title="Hệ thống AI Sinh Văn Bản (DeepSeek-R1)",
              description= "Hệ thống AI giúp tạo văn bản, câu trả lời dựa trên câu hỏi của bạn với tốc độ và độ chính xác cao")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_ID = "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B"

print("Đang tải model, vui lòng đợi...")

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)

model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    dtype=torch.bfloat16, 
    low_cpu_mem_usage=True
)

print("Tải model thành công!")


class GenerationRequest(BaseModel):
    prompt: str =  Field(..., min_length=5, max_length=600, description="Prompt sinh văn bản")
    temperature: float = Field(0.6, ge=0, le=1.0)

    max_length: int = 2048

    @field_validator('prompt')
    def prompt_must_not_be_empty(cls, v):
        if not v.strip():
            raise ValueError('Prompt không được chỉ chứa khoảng trắng.')
        return v 

class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=5, max_length=600, description="Prompt sinh văn bản")
    userId: Optional[str] = None
    sessionId: Optional[str] = None
    idToken: Optional[str] = None
    temperature: float = Field(0.6, ge=0, le=1.0)
    max_length: int = 2048

    @field_validator('prompt')
    def prompt_must_not_be_empty(cls, v):
        if not v.strip():
            raise ValueError('Prompt không được chỉ chứa khoảng trắng.')
        return v


def verify_firebase_token(id_token: Optional[str]):
    if not id_token:
        raise HTTPException(status_code=401, detail="Yêu cầu idToken Firebase để xác thực người dùng.")
    try:
        decoded_token = firebase_auth.verify_id_token(id_token)
        return decoded_token
    except Exception as e:
        print(f"Firebase token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Firebase token không hợp lệ hoặc đã hết hạn.")


def save_chat_to_firestore(user_id: str, session_id: str, prompt_text: str, assistant_text: str):
    now = datetime.utcnow()
    user_ref = db.collection("users").document(user_id)
    session_ref = user_ref.collection("sessions").document(session_id)

    user_ref.set({
        "last_seen": now,
        "updated_at": now,
        "user_id": user_id,
    }, merge=True)

    session_ref.set({
        "user_id": user_id,
        "last_updated": now,
        "created_at": now,
    }, merge=True)

    messages_ref = session_ref.collection("messages")
    messages_ref.add({
        "role": "user",
        "text": prompt_text,
        "timestamp": now,
    })
    messages_ref.add({
        "role": "assistant",
        "text": assistant_text,
        "timestamp": datetime.utcnow(),
    })

@app.get("/api")
def read_root():
    return {
        "description": "Chào mừng bạn đến với hệ thống sinh văn bản bằng AI, hệ thống sử dụng mô hình DeepSeek Distil R1 gọn nhẹ với độ chính xác và sự sáng tạo cao.",
        "usage": "Gửi POST request đến /generate với JSON chứa 'prompt'.",
        "model_used": MODEL_ID,
        "note": "Hệ thống trả lời các câu prompt tốt nhất bằng tiếng Anh, các câu prompt nên có nội dung đầy đủ rõ ràng."
    }


class AuthRequest(BaseModel):
    idToken: str


@app.post("/auth")
def auth(payload: AuthRequest):
    """Verify a Firebase ID token and return basic user info.
    """
    decoded = verify_firebase_token(payload.idToken)
    user_info = {
        "uid": decoded.get("uid"),
        "email": decoded.get("email"),
        "name": decoded.get("name"),
    }
    return {"status": "success", "user": user_info, "decodedToken": decoded}



@app.post("/generate")
def generate_text(request: GenerationRequest):

    if not request.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt không được để trống!")
    
    forbidden_words = ["nigga", "fuck", "hack"]
    if any(word in request.prompt.lower() for word in forbidden_words):
        raise HTTPException(status_code=403, detail="Prompt chứa nội dung hoặc từ ngữ không phù hợp.")

    try:

        import re

        def _remove_think_blocks(text: str):
            count = len(re.findall(r"</?think>", text, flags=re.IGNORECASE))
            cleaned = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE)
            cleaned = re.sub(r"</?think>", "", cleaned, flags=re.IGNORECASE).strip()
            return cleaned, count

        # Always include a System instruction to enforce English-only responses
        system_instr = (
            "<｜System｜>IMPORTANT: Respond ONLY in English. Do NOT include any Chinese, Japanese, Vietnamese, or other non-English words. "
            "If you would normally produce non-English content, instead provide an English translation only.\n"
        )
        userPrompt = f"{system_instr}<｜User｜>{request.prompt}<｜Assistant｜><think>\n"
        print(f"Đang sinh văn bản cho prompt: '{request.prompt}'...")
        inputs = tokenizer(userPrompt, return_tensors="pt")

        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=request.max_length,
                do_sample=True,
                temperature=request.temperature,
                pad_token_id=tokenizer.eos_token_id,
                top_p=0.95,
                eos_token_id=tokenizer.eos_token_id,
                no_repeat_ngram_size=3,
                repetition_penalty=1.1,
                top_k=50,
            )

        generated_text = tokenizer.decode(outputs[0], skip_special_tokens=True)
        print(f"🤖 Raw model output:\n{generated_text[:3000]}...\n")

        cleaned, think_count = _remove_think_blocks(generated_text)
        if "<｜Assistant｜>" in cleaned:
            cleaned = cleaned.split("<｜Assistant｜>")[-1].strip()

        # If the cleaned output is very short (model spent tokens in <think>), retry with stricter instruction
        final_answer = cleaned
        if (len(cleaned) < 80 and think_count > 0) or len(cleaned) < 10:
            print(f"⚠️ Cleaned output too short (len={len(cleaned)}), think_count={think_count}. Retrying with strict no-think instruction and larger token budget.")
            retry_max = int(min(2048, max(request.max_length * 2, request.max_length + 256)))
            retry_prompt = (
                "<｜System｜>IMPORTANT: When answering, DO NOT include any <think>...</think> sections or any internal reasoning tokens. "
                "Only output the final assistant reply. Provide a detailed, multi-paragraph answer (4+ paragraphs) with examples, explanations, and code samples if relevant.\n"
                f"<｜User｜>{request.prompt}<｜Assistant｜>"
            )
            inputs2 = tokenizer(retry_prompt, return_tensors="pt")
            with torch.no_grad():
                outputs2 = model.generate(
                    **inputs2,
                    max_new_tokens=retry_max,
                    do_sample=True,
                    temperature=max(0.35, request.temperature * 0.9),
                    pad_token_id=tokenizer.eos_token_id,
                    top_p=0.95,
                    eos_token_id=tokenizer.eos_token_id,
                    no_repeat_ngram_size=3,
                    repetition_penalty=1.1,
                    top_k=50,
                )
            retry_text = tokenizer.decode(outputs2[0], skip_special_tokens=True)
            print(f"🤖 Retry raw output:\n{retry_text[:1500]}...\n")
            retry_cleaned, _ = _remove_think_blocks(retry_text)
            if "<｜Assistant｜>" in retry_cleaned:
                retry_cleaned = retry_cleaned.split("<｜Assistant｜>")[-1].strip()
            if len(retry_cleaned) > len(final_answer):
                final_answer = retry_cleaned

        if not final_answer or len(final_answer) < 3:
            final_answer = cleaned or generated_text.strip()

        
        cjk_re = re.compile(r"[\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF00-\uFFEF\u3040-\u309F\u30A0-\u30FF]")
        if cjk_re.search(final_answer):
            print(f"⚠️ Detected non-English characters in output; retrying with explicit English-only instruction.")
            retry_max2 = int(min(2048, max(request.max_length * 2, request.max_length + 512)))
            retry_prompt2 = (
                "<｜System｜>STRICT: Answer ONLY in English. Absolutely no non-English characters or words. If examples from other languages are necessary, provide them in English translation only.\n"
                f"<｜User｜>{request.prompt}<｜Assistant｜>"
            )
            inputs3 = tokenizer(retry_prompt2, return_tensors="pt")
            with torch.no_grad():
                outputs3 = model.generate(
                    **inputs3,
                    max_new_tokens=retry_max2,
                    do_sample=True,
                    temperature=max(0.35, request.temperature * 0.9),
                    pad_token_id=tokenizer.eos_token_id,
                    top_p=0.98,
                    eos_token_id=tokenizer.eos_token_id,
                    no_repeat_ngram_size=2,
                    repetition_penalty=1.03,
                    top_k=40,
                )
            retry3_text = tokenizer.decode(outputs3[0], skip_special_tokens=True)
            retry3_cleaned, _ = _remove_think_blocks(retry3_text)
            if "<｜Assistant｜>" in retry3_cleaned:
                retry3_cleaned = retry3_cleaned.split("<｜Assistant｜>")[-1].strip()
            # accept retry3 only if it contains no CJK characters
            if not cjk_re.search(retry3_cleaned) and len(retry3_cleaned) > len(final_answer):
                final_answer = retry3_cleaned

        print(f"✅ Final answer (cleaned) length={len(final_answer)}:\n{final_answer[:1500]}...\n")
        return {"status": "success", "data": final_answer}

    except torch.cuda.OutOfMemoryError:
        raise HTTPException(status_code=507, detail="Hệ thống quá tải bộ nhớ, vui lòng thử lại sau.")

    except Exception as e:
        print(f"Lỗi hệ thống: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Đã xảy ra lỗi trong quá trình xử lý của mô hình AI."
        )

@app.post("/chat")
def chat(request: ChatRequest):
    print(f"\n{'='*60}")
    print(f"✅ POST /chat received")
    print(f"📝 Prompt: {request.prompt}")
    print(f"👤 UserID: {request.userId}")
    print(f"💬 SessionID: {request.sessionId}")
    print(f"{'='*60}\n")
    
    decoded = verify_firebase_token(request.idToken)
    user_id = decoded.get("uid")
    print(f"🔐 Decoded user_id: {user_id}")
    
    if request.userId and request.userId != user_id:
        raise HTTPException(status_code=403, detail="userId không hợp lệ cho token này.")

    session_id = request.sessionId or f"session-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    print(f"🆔 Final session_id: {session_id}")
    
    generation_request = GenerationRequest(
        prompt=request.prompt,
        temperature=request.temperature,
        max_length=request.max_length,
    )
    print(f"🤖 Calling generate_text...")
    result = generate_text(generation_request)

    if result.get("status") == "success":
        print(f"💾 Saving to Firestore...")
        save_chat_to_firestore(user_id, session_id, request.prompt, result["data"])
        print(f"✅ Response sent successfully")
        return {
            "status": "success",
            "data": result["data"],
            "sessionId": session_id,
            "timestamp": datetime.utcnow().isoformat(),
        }
    print(f"❌ Generate failed: {result}")
    return result


@app.get("/sessions/{session_id}")
def get_session_history(session_id: str, userId: str, idToken: str):
    decoded = verify_firebase_token(idToken)
    if decoded.get("uid") != userId:
        raise HTTPException(status_code=403, detail="userId không hợp lệ cho token này.")

    session_ref = db.collection("users").document(userId).collection("sessions").document(session_id)
    session_doc = session_ref.get()
    if not session_doc.exists:
        raise HTTPException(status_code=404, detail="Session không tồn tại.")

    messages = []
    docs = session_ref.collection("messages").order_by("timestamp").stream()
    for doc in docs:
        payload = doc.to_dict()
        messages.append({
            "id": doc.id,
            "role": payload.get("role"),
            "text": payload.get("text"),
            "timestamp": payload.get("timestamp").isoformat() if payload.get("timestamp") else None,
        })

    return {
        "status": "success",
        "sessionId": session_id,
        "messages": messages,
    }


class SessionCreate(BaseModel):
    idToken: str
    name: Optional[str] = None


@app.post("/sessions")
def create_session(payload: SessionCreate):
    decoded = verify_firebase_token(payload.idToken)
    user_id = decoded.get("uid")

    session_id = f"session-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    now = datetime.utcnow()

    user_ref = db.collection("users").document(user_id)
    session_ref = user_ref.collection("sessions").document(session_id)

    session_ref.set({
        "user_id": user_id,
        "name": payload.name or "New session",
        "created_at": now,
        "last_updated": now,
    }, merge=True)

    return {"status": "success", "sessionId": session_id, "created_at": now.isoformat()}


@app.get("/sessions")
def list_sessions(idToken: str):
    decoded = verify_firebase_token(idToken)
    user_id = decoded.get("uid")

    sessions = []
    sessions_ref = db.collection("users").document(user_id).collection("sessions")
    try:
        docs = sessions_ref.order_by("created_at", direction=firestore.Query.DESCENDING).stream()
    except Exception:
        docs = sessions_ref.stream()

    for doc in docs:
        payload = doc.to_dict() or {}
        sessions.append({
            "sessionId": doc.id,
            "name": payload.get("name"),
            "created_at": payload.get("created_at").isoformat() if payload.get("created_at") else None,
            "last_updated": payload.get("last_updated").isoformat() if payload.get("last_updated") else None,
        })

    return {"status": "success", "sessions": sessions}


class SessionRename(BaseModel):
    idToken: str
    name: str


@app.patch("/sessions/{session_id}")
def rename_session(session_id: str, payload: SessionRename):
    decoded = verify_firebase_token(payload.idToken)
    user_id = decoded.get("uid")

    session_ref = db.collection("users").document(user_id).collection("sessions").document(session_id)
    if not session_ref.get().exists:
        raise HTTPException(status_code=404, detail="Session không tồn tại.")

    now = datetime.utcnow()
    session_ref.update({
        "name": payload.name,
        "last_updated": now,
    })

    return {"status": "success", "sessionId": session_id, "name": payload.name, "last_updated": now.isoformat()}


@app.delete("/sessions/{session_id}")
def delete_session(session_id: str, idToken: str):
    decoded = verify_firebase_token(idToken)
    user_id = decoded.get("uid")

    user_ref = db.collection("users").document(user_id)
    session_ref = user_ref.collection("sessions").document(session_id)

    if not session_ref.get().exists:
        raise HTTPException(status_code=404, detail="Session không tồn tại.")

    # Delete messages in the session (Firestore doesn't support recursive delete in admin SDK directly)
    messages = session_ref.collection("messages").stream()
    for msg in messages:
        msg.reference.delete()

    session_ref.delete()

    return {"status": "success", "sessionId": session_id}

@app.get("/health")
def health_check():
    health_status = {
        "status": "Server hoạt động ổn.",
        "timestamp": datetime.now().isoformat(),
        "details": {}
    }
    
    try:
        mem = psutil.virtual_memory()
        health_status["details"]["memory"] = {
            "total_gb": round(mem.total / (1024**3), 2),
            "available_gb": round(mem.available / (1024**3), 2),
            "percent_used": mem.percent
        }
        
        if 'model' in globals() and model is not None:
            health_status["details"]["model_loaded"] = True
            health_status["details"]["device"] = str(model.device)
        else:
            health_status["status"] = "Server đang gặp vấn đề về model!"
            health_status["details"]["model_loaded"] = False

        health_status["details"]["cpu_usage_percent"] = psutil.cpu_percent(interval=1)

    except Exception as e:
        health_status["status"] = "Server bị lỗi hoặc không thể kết nối!"
        health_status["details"]["error"] = str(e)

    return health_status


app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")