# Set kernel parent-death behavior in a fresh process, never Python preexec_fn.
import ctypes,os,signal,sys
parent=os.getppid()
if ctypes.CDLL(None,use_errno=True).prctl(1,signal.SIGKILL)!=0:raise OSError(ctypes.get_errno())
if parent==1 or os.getppid()!=parent:sys.exit(1)
os.execvp('node',['node',*sys.argv[1:]])
