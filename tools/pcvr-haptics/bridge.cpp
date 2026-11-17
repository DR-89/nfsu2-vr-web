#include <winsock2.h>
#include <ws2tcpip.h>
#include "shared.h"
#include <bcrypt.h>
#include <algorithm>
#include <fstream>
#include <iostream>
#include <map>
#include <string>
#include <cctype>

namespace {
std::string lower(std::string s){for(auto& c:s)c=static_cast<char>(std::tolower(static_cast<unsigned char>(c)));return s;}
bool send_all(SOCKET socket,const std::string& data){size_t n=0;while(n<data.size()){int sent=send(socket,data.data()+n,static_cast<int>(data.size()-n),0);if(sent<=0)return false;n+=sent;}return true;}
void serve(SOCKET socket,const std::string& origin,const std::string& token,haptics::Shared* shared){
    DWORD timeout=1000;setsockopt(socket,SOL_SOCKET,SO_RCVTIMEO,reinterpret_cast<char*>(&timeout),sizeof(timeout));
    setsockopt(socket,SOL_SOCKET,SO_SNDTIMEO,reinterpret_cast<char*>(&timeout),sizeof(timeout));
    std::string raw;char buffer[4096];size_t end;
    while((end=raw.find("\r\n\r\n"))==std::string::npos){
        int n=recv(socket,buffer,sizeof(buffer),0);if(n<=0)return;raw.append(buffer,n);if(raw.size()>4096)return;
    }
    auto line=raw.find("\r\n"),space=raw.find(' '),last=raw.find(' ',space+1);
    if(space>=line||last>=line)return;
    std::string method=raw.substr(0,space),path=raw.substr(space+1,last-space-1);
    std::map<std::string,std::string> headers;
    for(size_t at=line+2;at<end;){
        auto to=raw.find("\r\n",at),colon=raw.find(':',at);if(colon>=to)return;
        auto key=lower(raw.substr(at,colon-at));size_t value=colon+1;while(value<to&&raw[value]==' ')value++;
        if(headers.count(key))return;headers[key]=raw.substr(value,to-value);at=to+2;
    }
    bool allowed=headers["origin"]==origin;
    auto reply=[&](int status,const std::string& body=""){
        std::string response="HTTP/1.1 "+std::to_string(status)+" "+(status==200?"OK":status==204?"No Content":"Rejected")+"\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: application/json\r\n";
        if(allowed)response+="Access-Control-Allow-Origin: "+origin+"\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type, x-nfsu2-haptics, x-nfsu2-connect\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Max-Age: 600\r\n";
        send_all(socket,response+"Content-Length: "+std::to_string(body.size())+"\r\n\r\n"+body);
    };
    if(!allowed){reply(403);return;}
    if(method=="OPTIONS"&&(path=="/connect"||path=="/status"||path=="/pulse")){reply(204);return;}
    // A custom header requires a successful CORS preflight. Only the configured
    // game origin can discover the per-process capability; ordinary forms cannot.
    if(method=="GET"&&path=="/connect"&&headers["x-nfsu2-connect"]=="1"){
        reply(200,"{\"version\":1,\"token\":\""+token+"\"}");return;
    }
    if(headers["x-nfsu2-haptics"]!=token){reply(403);return;}
    if(method=="GET"&&path=="/status"){
        auto beat=InterlockedCompareExchange64(&shared->heartbeat,0,0);
        bool ready=shared->attached&&shared->bound>0&&beat>0&&GetTickCount64()-static_cast<uint64_t>(beat)<1500;
        auto process=OpenProcess(SYNCHRONIZE,FALSE,static_cast<DWORD>(shared->initialized));
        bool initialized=ready||(process&&WaitForSingleObject(process,0)==WAIT_TIMEOUT);if(process)CloseHandle(process);
        auto output=InterlockedCompareExchange64(&shared->output_at,0,0);
        bool recent=output>0&&GetTickCount64()-static_cast<uint64_t>(output)<1500;
        reply(200,std::string("{\"version\":1,\"bridgeVersion\":3,\"ready\":")+(ready?"true":"false")+",\"initialized\":"+(initialized?"true":"false")+",\"focused\":"+(ready&&shared->focused?"true":"false")+",\"result\":"+std::to_string(shared->result)+
            ",\"bound\":"+std::to_string(shared->bound)+",\"received\":"+std::to_string(shared->received)+",\"applied\":"+std::to_string(shared->applied)+",\"rejected\":"+std::to_string(shared->rejected)+",\"outputRecent\":"+(recent?"true":"false")+"}");return;
    }
    if(method!="POST"||path!="/pulse"){reply(404);return;}
    if(headers["content-length"]!="16"||headers.count("transfer-encoding")||headers["content-type"]!="application/octet-stream"){reply(400);return;}
    auto body=raw.substr(end+4);
    while(body.size()<16){int n=recv(socket,buffer,static_cast<int>(16-body.size()),0);if(n<=0)return;body.append(buffer,n);}
    if(body.size()!=16){reply(400);return;}
    float values[4];std::memcpy(values,body.data(),16);haptics::Packet packet{};packet.at=GetTickCount64();
    for(int h=0;h<2;h++){
        if(!haptics::valid(values[h*2],values[h*2+1])){reply(400);return;}
        packet.amplitude[h]=values[h*2];packet.duration[h]=static_cast<uint32_t>(std::ceil(values[h*2+1]));
    }
    haptics::publish(shared,packet);InterlockedIncrement(&shared->received);reply(204);
}
}
int main(int argc,char** argv){
    bool automatic=argc==3&&!std::strcmp(argv[1],"--background");
    if(!automatic&&argc!=4){std::cerr<<"Usage: haptics-bridge --background <page-origin> or <page-origin> <token> <port-file>\n";return 1;}
    std::string origin=argv[automatic?2:1],token=automatic?"":argv[2];
    HANDLE guard=nullptr;
    if(automatic){
        guard=CreateMutexW(nullptr,FALSE,L"Local\\NFSU2WebHapticsBackground-v1");
        if(!guard)return 1;if(GetLastError()==ERROR_ALREADY_EXISTS){CloseHandle(guard);return 0;}
        unsigned char random[16];if(BCryptGenRandom(nullptr,random,sizeof(random),BCRYPT_USE_SYSTEM_PREFERRED_RNG)<0)return 1;
        constexpr char hex[]="0123456789abcdef";for(auto byte:random){token+=hex[byte>>4];token+=hex[byte&15];}
    }
    if(token.size()!=32||token.find_first_not_of("0123456789abcdef")!=std::string::npos||origin.find_first_of("\r\n")!=std::string::npos)return 1;
    haptics::Mapping mapping;if(!mapping.open(true)){std::cerr<<"Cannot create haptics channel\n";return 1;}
    WSADATA data;if(WSAStartup(MAKEWORD(2,2),&data))return 1;
    SOCKET listener=socket(AF_INET,SOCK_STREAM,IPPROTO_TCP);if(listener==INVALID_SOCKET)return 1;
    BOOL exclusive=TRUE;setsockopt(listener,SOL_SOCKET,SO_EXCLUSIVEADDRUSE,reinterpret_cast<char*>(&exclusive),sizeof(exclusive));
    sockaddr_in address{};address.sin_family=AF_INET;address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
    if(automatic)address.sin_port=htons(haptics::automatic_port);
    if(bind(listener,reinterpret_cast<sockaddr*>(&address),sizeof(address))||listen(listener,8))return 1;
    int length=sizeof(address);getsockname(listener,reinterpret_cast<sockaddr*>(&address),&length);
    if(!automatic){std::ofstream output(argv[3]);output<<ntohs(address.sin_port);if(!output)return 1;}
    for(;;){SOCKET client=accept(listener,nullptr,nullptr);if(client==INVALID_SOCKET)break;serve(client,origin,token,mapping.data);closesocket(client);}
    closesocket(listener);WSACleanup();if(guard)CloseHandle(guard);return 0;
}
