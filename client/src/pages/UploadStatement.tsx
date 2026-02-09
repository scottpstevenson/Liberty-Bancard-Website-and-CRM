import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { UploadCloud, FileText, CheckCircle, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";

export default function UploadStatement() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
      // Mock upload process
      setUploading(true);
      setTimeout(() => {
        setUploading(false);
        setSuccess(true);
      }, 2000);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/*': ['.png', '.jpg', '.jpeg']
    },
    maxFiles: 1
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-display font-bold text-primary mb-2">Upload Statement</h1>
            <p className="text-muted-foreground">Securely upload your merchant statement for AI analysis.</p>
          </div>

          <div 
            {...getRootProps()} 
            className={`
              relative overflow-hidden
              border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 cursor-pointer
              bg-white shadow-lg
              ${isDragActive ? "border-accent bg-accent/5 scale-[1.02]" : "border-border hover:border-accent/50"}
            `}
          >
            <input {...getInputProps()} />
            
            {success ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center text-green-600"
              >
                <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-4">
                  <CheckCircle className="w-10 h-10" />
                </div>
                <h3 className="text-xl font-bold mb-2">Upload Complete!</h3>
                <p className="text-muted-foreground mb-6">Our team is analyzing your data.</p>
                <Button onClick={(e) => { e.stopPropagation(); setFile(null); setSuccess(false); }} variant="outline">
                  Upload Another
                </Button>
              </motion.div>
            ) : uploading ? (
              <div className="flex flex-col items-center">
                <div className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center mb-4 relative">
                  <div className="absolute inset-0 border-4 border-accent/20 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
                  <UploadCloud className="w-8 h-8 text-accent" />
                </div>
                <h3 className="text-xl font-bold text-primary mb-1">Analyzing...</h3>
                <p className="text-sm text-muted-foreground">Extracting fees and rates</p>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-6">
                  <UploadCloud className="w-10 h-10 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-bold text-primary mb-2">
                  {isDragActive ? "Drop file here" : "Click or drag file"}
                </h3>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-6">
                  Support for PDF, JPG, PNG. Max 10MB. <br/>
                  Your data is encrypted and secure.
                </p>
                <Button className="pointer-events-none">Select File</Button>
              </div>
            )}
          </div>
          
          <div className="mt-6 flex items-start gap-3 p-4 bg-blue-50 text-blue-800 rounded-lg text-sm">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p>
              We use bank-grade encryption to process your statements. 
              Your data is never shared with third parties without your consent.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
