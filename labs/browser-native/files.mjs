import {openSync,closeSync,fstatSync,readSync,writeFileSync,renameSync,constants} from 'node:fs';
import {randomUUID} from 'node:crypto';

export function readJSON(path,maximum=65536){
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const stat=fstatSync(fd);if(!stat.isFile()||stat.size>maximum)throw Error('invalid_file');
    const buffer=Buffer.alloc(maximum+1);let total=0,count;
    do {count=readSync(fd,buffer,total,buffer.length-total,null);total+=count;} while(count>0&&total<buffer.length);
    if(total>maximum)throw Error('invalid_file');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,total)));
  }
  finally {closeSync(fd);}
}
export function writePrivate(path,value){
  const temporary=path+'.'+randomUUID()+'.tmp';
  writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
  renameSync(temporary,path);
}
