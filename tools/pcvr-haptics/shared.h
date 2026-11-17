#pragma once
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <cmath>
#include <cstdint>
#include <cstring>

namespace haptics {
constexpr wchar_t map_env[] = L"NFSU2_WEB_HAPTICS_MAP";
constexpr wchar_t automatic_map[] = L"Local\\NFSU2WebHapticsAuto-v1";
constexpr unsigned short automatic_port = 28765;
constexpr char layer_name[] = "XR_APILAYER_NFSU2_web_haptics";
struct Packet { uint64_t at; float amplitude[2]; uint32_t duration[2]; };
struct Shared {
    volatile LONG sequence;
    uint32_t version;
    Packet packet;
    volatile LONG initialized, owner, attached, focused, result;
    alignas(8) volatile LONG64 heartbeat;
    volatile LONG received, applied, rejected, bound;
    alignas(8) volatile LONG64 output_at;
};
inline bool valid(float amplitude, float duration) {
    return std::isfinite(amplitude) && amplitude >= 0 && amplitude <= 1 &&
        std::isfinite(duration) && duration >= 0 && duration <= 100;
}
inline void publish(Shared* s, const Packet& p) {
    InterlockedIncrement(&s->sequence); MemoryBarrier(); s->packet=p;
    MemoryBarrier(); InterlockedIncrement(&s->sequence);
}
inline bool read(Shared* s, Packet& p, LONG& seq) {
    for(int tries=0;tries<3;tries++) {
        seq=InterlockedCompareExchange(&s->sequence,0,0); if(seq&1)continue;
        p=s->packet; MemoryBarrier();
        if(seq==InterlockedCompareExchange(&s->sequence,0,0))return true;
    }
    return false;
}
struct Mapping {
    HANDLE handle=nullptr,file=INVALID_HANDLE_VALUE; Shared* data=nullptr;
    bool open(bool create) {
        wchar_t name[160]{};
        if(GetEnvironmentVariableW(map_env,name,160)){
            handle=create?CreateFileMappingW(INVALID_HANDLE_VALUE,nullptr,PAGE_READWRITE,0,sizeof(Shared),name)
                         :OpenFileMappingW(FILE_MAP_READ|FILE_MAP_WRITE,FALSE,name);
        }else{
            // An AppContainer cannot see the desktop process's named-object
            // namespace. Both processes map the same, narrowly ACLed file.
            // Resolve from this code's module: the DLL and helper live together;
            // the sandbox redirects ordinary LocalAppData lookups elsewhere.
            HMODULE module=nullptr;wchar_t path[32768]{};
            if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                reinterpret_cast<LPCWSTR>(&valid),&module)||!GetModuleFileNameW(module,path,32768))return false;
            auto* slash=wcsrchr(path,L'\\');if(!slash)return false;wcscpy_s(slash+1,32768-(slash+1-path),L"channel.bin");
            file=CreateFileW(path,GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);
            if(file==INVALID_HANDLE_VALUE)return false;
            handle=CreateFileMappingW(file,nullptr,PAGE_READWRITE,0,4096,nullptr);
        }
        if(!handle)return false;
        data=static_cast<Shared*>(MapViewOfFile(handle,FILE_MAP_ALL_ACCESS,0,0,sizeof(Shared)));
        if(!data)return false;
        if(create){std::memset(data,0,sizeof(*data));data->version=1;}
        return data->version==1;
    }
    ~Mapping(){if(data)UnmapViewOfFile(data);if(handle)CloseHandle(handle);if(file!=INVALID_HANDLE_VALUE)CloseHandle(file);}
};
}
