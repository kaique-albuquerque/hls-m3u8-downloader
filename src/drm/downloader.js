// src/drm/downloader.js
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Baixa vídeos protegidos por DRM
 */
export class DRMDownloader {
  constructor(options = {}) {
    this.options = {
      outputDir: options.outputDir || './downloads',
      verbose: options.verbose || false,
      ...options
    };
    
    // Cria diretório de saída se não existir
    if (!fs.existsSync(this.options.outputDir)) {
      fs.mkdirSync(this.options.outputDir, { recursive: true });
    }
  }

  /**
   * Detecta tipo de DRM e aplica o contorno apropriado
   */
  async download(url, options = {}) {
    try {
      // Primeiro detecta o tipo de DRM
      const drmInfo = await this.detectDRM(url);
      
      if (drmInfo.type === 'widevine') {
        return await this.downloadWidevine(url, options);
      } else if (drmInfo.type === 'playready') {
        return await this.downloadPlayReady(url, options);
      } else if (drmInfo.type === 'fairplay') {
        return await this.downloadFairPlay(url, options);
      } else {
        // Se não for DRM, usa download normal
        return await this.downloadNormal(url, options);
      }
    } catch (error) {
      console.error('Erro no download:', error);
      throw error;
    }
  }

  /**
   * Detecta tipo de DRM no conteúdo
   */
  async detectDRM(url) {
    // Usa FFmpeg para detectar DRM
    const ffprobe = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', url]);
    
    return new Promise((resolve, reject) => {
      let output = '';
      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      ffprobe.on('close', (code) => {
        if (code === 0) {
          const info = JSON.parse(output);
          const drmType = this.identifyDRM(info);
          resolve({ type: drmType, info });
        } else {
          reject(new Error('Falha ao detectar DRM'));
        }
      });
    });
  }

  /**
   * Identifica tipo de DRM com base em metadados
   */
  identifyDRM(info) {
    // Verifica se há DRM na resposta
    if (info.streams.some(s => s.codec_type === 'subtitle' && 
        (s.codec_name.includes('webvtt') || s.codec_name.includes('ttml')))) {
      return 'widevine'; // Assume Widevine se tiver subtítulos WebVTT
    }
    
    // Verifica por PlayReady
    if (info.format.tags?.['com.microsoft.playready'] ||
        info.format.tags?.['com.apple.streaming'] ||
        info.streams.some(s => s.codec_name.includes('hvc1'))) {
      return 'playready';
    }
    
    // Verifica por FairPlay
    if (info.streams.some(s => s.codec_name.includes('hvc1') && 
        s.codec_tag_string === 'f4v1')) {
      return 'fairplay';
    }
    
    return null; // Sem DRM
  }

  /**
   * Baixa conteúdo protegido por Widevine
   */
  async downloadWidevine(url, options) {
    const manifest = await this.fetchManifest(url);
    const licenseUrl = this.extractLicenseUrl(manifest);
    const key = await this.requestWidevineLicense(licenseUrl, manifest);
    
    // Usa FFmpeg com chave de licença
    const outputFile = path.join(
      this.options.outputDir,
      `${this.generateFilename(url)}.mkv`
    );
    
    const ffmpegArgs = [
      '-i', url,
      '-c', 'copy',
      '-key', key,
      '-o', outputFile
    ];
    
    return this.runFFmpeg(ffmpegArgs);
  }

  /**
   * Baixa conteúdo protegido por PlayReady
   */
  async downloadPlayReady(url, options) {
    const manifest = await this.fetchManifest(url);
    const cert = await this.fetchPlayReadyCertificate(manifest);
    const license = await this.requestPlayReadyLicense(cert, manifest);
    
    // Usa FFmpeg com certificado de licença
    const outputFile = path.join(
      this.options.outputDir,
      `${this.generateFilename(url)}.mkv`
    );
    
    const ffmpegArgs = [
      '-i', url,
      '-c', 'copy',
      '-cert', cert,
      '-license', license,
      '-o', outputFile
    ];
    
    return this.runFFmpeg(ffmpegArgs);
  }

  /**
   * Baixa conteúdo protegido por FairPlay
   */
  async downloadFairPlay(url, options) {
    const manifest = await this.fetchManifest(url);
    const token = await this.generateFairPlayToken(manifest);
    
    // Usa curl-impersonate com token
    const curlArgs = [
      '--impersonate', 'safari',
      '--header', `Authorization: Bearer ${token}`,
      url
    ];
    
    const outputFile = path.join(
      this.options.outputDir,
      `${this.generateFilename(url)}.mov`
    );
    
    return this.runCurl(curlArgs, outputFile);
  }

  /**
   * Download normal para conteúdo sem DRM
   */
  /**
 * Download normal para conteúdo sem DRM
 */
async downloadNormal(url, options) {
  const outputFile = path.join(
    this.options.outputDir,
    `${this.generateFilename(url)}.mkv`
  );
  
  // Usa o novo método com fallbacks
  return await this.downloadWithYtDlpFallback(url, { ...options, output: outputFile });
}

  /**
   * Gera nome de arquivo baseado na URL
   */
  generateFilename(url) {
    return path.basename(url, path.extname(url));
  }

  /**
   * Executa FFmpeg com argumentos
   */
  runFFmpeg(args) {
    const ffmpeg = spawn('ffmpeg', args);
    
    return new Promise((resolve, reject) => {
      let output = '';
      ffmpeg.stdout.on('data', (data) => {
        output += data.toString();
        if (this.options.verbose) {
          console.log(data.toString());
        }
      });
      
      ffmpeg.stderr.on('data', (data) => {
        if (this.options.verbose) {
          console.error(data.toString());
        }
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`FFmpeg falhou com código ${code}`));
        }
      });
    });
  }

  /**
   * Executa curl-impersonate com argumentos
   */
  runCurl(args, outputFile) {
    const curl = spawn('curl-impersonate', args);
    
    return new Promise((resolve, reject) => {
      let output = '';
      curl.stdout.on('data', (data) => {
        output += data.toString();
        if (this.options.verbose) {
          console.log(data.toString());
        }
      });
      
      curl.stderr.on('data', (data) => {
        if (this.options.verbose) {
          console.error(data.toString());
        }
      });
      
      curl.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`curl-impersonate falhou com código ${code}`));
        }
      });
    });
  }

  /**
   * Busca manifest do conteúdo
   */
  fetchManifest(url) {
    // Implementação específica para HLS/DASH
    // Pode usar curl-impersonate para evitar bloqueios
    return this.runCurl(['--impersonate', 'chrome', url], '');
  }

  /**
   * Extrai URL da licença de Widevine
   */
  extractLicenseUrl(manifest) {
    // Parse do manifest para encontrar URL da licença
    // Exemplo: buscar por <ContentProtection>
    return 'https://example.com/license';
  }

  /**
   * Requisita licença Widevine
   */
  requestWidevineLicense(licenseUrl, manifest) {
    // Implementação específica para Widevine
    // Pode usar curl-impersonate com headers específicos
    return this.runCurl([
      '--impersonate', 'chrome',
      '--header', 'Content-Type: application/octet-stream',
      '--data-binary', manifest,
      licenseUrl
    ], '');
  }

  /**
   * Busca certificado PlayReady
   */
  fetchPlayReadyCertificate(manifest) {
    // Implementação específica para PlayReady
    return 'certificado_base64';
  }

  /**
   * Requisita licença PlayReady
   */
  requestPlayReadyLicense(cert, manifest) {
    // Implementação específica para PlayReady
    return 'licenca_base64';
  }

  /**
   * Gera token FairPlay
   */
  generateFairPlayToken(manifest) {
    // Implementação específica para FairPlay
    return 'token_fairplay';
  }

  /**
 * Tenta download com diferentes codecs de áudio e conversões
 */
async downloadWithAdvancedFallbacks(url, options) {
  const attempts = [
    // Codec padrão
    ['-c', 'copy'],
    
    // AAC com ajustes
    ['-c:v', 'copy', '-c:a', 'aac', '-strict', '-2', '-bsf:a', 'aac_adtstoasc'],
    
    // MP3 alternativo
    ['-c:v', 'copy', '-c:a', 'mp3'],
    
    // Libmp3lame
    ['-c:v', 'copy', '-c:a', 'libmp3lame'],
    
    // Cópia de áudio
    ['-c:v', 'copy', '-c:a', 'copy'],
    
    // Conversão completa
    ['-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-c:a', 'aac', '-strict', '-2'],
    
    // Cópia com conversão de container
    ['-c:v', 'copy', '-c:a', 'aac', '-strict', '-2', '-f', 'mp4']
  ];
  
  for (const attempt of attempts) {
    try {
      console.log(`Tentando: ${attempt.join(' ')}`);
      return await this.runFFmpeg([...attempt, '-i', url, '-o', options.output]);
    } catch (error) {
      console.warn(`Falhou: ${attempt.join(' ')} -`, error.message);
    }
  }
  
  throw new Error('Todos os métodos falharam');
}

/**
 * Tenta download com yt-dlp como último recurso
 */
async downloadWithYtDlpFallback(url, options) {
  // Primeiro tenta com FFmpeg
  try {
    return await this.downloadWithAdvancedFallbacks(url, options);
  } catch (error) {
    console.warn('FFmpeg falhou, tentando yt-dlp:', error.message);
    
    // Tenta com yt-dlp
    try {
      const ytDlp = spawn('yt-dlp', ['-o', options.output, url]);
      
      return new Promise((resolve, reject) => {
        let output = '';
        ytDlp.stdout.on('data', (data) => {
          output += data.toString();
          console.log(data.toString());
        });
        
        ytDlp.stderr.on('data', (data) => {
          console.error(data.toString());
        });
        
        ytDlp.on('close', (code) => {
          if (code === 0) {
            resolve(output);
          } else {
            reject(new Error(`yt-dlp falhou com código ${code}`));
          }
        });
      });
    } catch (ytDlpError) {
      throw new Error(`Todos os métodos falharam: ${error.message}, ${ytDlpError.message}`);
    }
  }
}
}