use iced::mouse;
use iced::widget::shader::{self, Pipeline, Primitive, Viewport};
use iced::{Color, Rectangle};
use iced::wgpu;

#[derive(Debug, Clone)]
pub struct AuroraShader {
    pub time: f32,
    pub base_bg: Color,
    pub color_a: Color,
    pub color_b: Color,
    pub color_c: Color,
    pub y_offset_px: f32,
    pub intensity: f32,
}

#[derive(Debug, Default)]
pub struct AuroraState;

impl<Message> shader::Program<Message> for AuroraShader {
    type State = AuroraState;
    type Primitive = AuroraPrimitive;

    fn draw(
        &self,
        _state: &Self::State,
        _cursor: mouse::Cursor,
        _bounds: Rectangle,
    ) -> Self::Primitive {
        AuroraPrimitive {
            time: self.time,
            base_bg: [self.base_bg.r, self.base_bg.g, self.base_bg.b, self.intensity],
            color_a: [self.color_a.r, self.color_a.g, self.color_a.b, 1.0],
            color_b: [self.color_b.r, self.color_b.g, self.color_b.b, 1.0],
            color_c: [self.color_c.r, self.color_c.g, self.color_c.b, 1.0],
            y_offset_px: self.y_offset_px,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AuroraPrimitive {
    time: f32,
    base_bg: [f32; 4],
    color_a: [f32; 4],
    color_b: [f32; 4],
    color_c: [f32; 4],
    y_offset_px: f32,
}

pub struct AuroraPipeline {
    pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
}

const UNIFORM_BYTES: usize = 80; // 5 x vec4<f32> = 20 floats = 80 bytes

impl Pipeline for AuroraPipeline {
    fn new(device: &wgpu::Device, _queue: &wgpu::Queue, format: wgpu::TextureFormat) -> Self {
        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("bs.aurora.uniforms"),
            size: UNIFORM_BYTES as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("bs.aurora.bind_group_layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("bs.aurora.bind_group"),
            layout: &bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("bs.aurora.pipeline_layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("bs.aurora.wgsl"),
            source: wgpu::ShaderSource::Wgsl(AURORA_WGSL.into()),
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("bs.aurora.pipeline"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        Self {
            pipeline,
            uniform_buffer,
            bind_group,
        }
    }
}

impl Primitive for AuroraPrimitive {
    type Pipeline = AuroraPipeline;

    fn prepare(
        &self,
        pipeline: &mut Self::Pipeline,
        _device: &wgpu::Device,
        queue: &wgpu::Queue,
        bounds: &Rectangle,
        _viewport: &Viewport,
    ) {
        let h = bounds.height.max(1.0);
        let y_ratio = (self.y_offset_px / h).clamp(0.0, 1.0);
        let floats: [f32; 20] = [
            self.time,
            bounds.width.max(1.0),
            h,
            y_ratio,
            self.base_bg[0],
            self.base_bg[1],
            self.base_bg[2],
            self.base_bg[3],
            self.color_a[0],
            self.color_a[1],
            self.color_a[2],
            self.color_a[3],
            self.color_b[0],
            self.color_b[1],
            self.color_b[2],
            self.color_b[3],
            self.color_c[0],
            self.color_c[1],
            self.color_c[2],
            self.color_c[3],
        ];
        let mut bytes = [0u8; UNIFORM_BYTES];
        for (idx, f) in floats.iter().enumerate() {
            bytes[idx * 4..idx * 4 + 4].copy_from_slice(&f.to_le_bytes());
        }
        queue.write_buffer(&pipeline.uniform_buffer, 0, &bytes);
    }

    fn draw(&self, pipeline: &Self::Pipeline, render_pass: &mut wgpu::RenderPass<'_>) -> bool {
        render_pass.set_pipeline(&pipeline.pipeline);
        render_pass.set_bind_group(0, &pipeline.bind_group, &[]);
        render_pass.draw(0..3, 0..1);
        true
    }
}

const AURORA_WGSL: &str = r#"
struct Uniforms {
    params: vec4<f32>, // x = time, y = width, z = height, w = y_ratio
    base_bg: vec4<f32>, // a = intensity
    color_a: vec4<f32>,
    color_b: vec4<f32>,
    color_c: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

struct VsOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VsOut {
    var output: VsOut;
    let x = f32((idx << 1u) & 2u);
    let y = f32(idx & 2u);
    output.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
    output.uv = vec2<f32>(x, y);
    return output;
}

fn orb(uv: vec2<f32>, center: vec2<f32>, radius: vec2<f32>) -> f32 {
    let d = (uv - center) / radius;
    let dist2 = dot(d, d);
    return exp(-dist2 * 1.35);
}

fn dither_hash(p: vec2<f32>) -> f32 {
    let h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
    let y_off = u.params.w;
    if (y_off > 0.0005 && input.uv.y < y_off) {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }

    let t = u.params.x * 0.24;
    let uv = vec2<f32>(input.uv.x, input.uv.y - y_off);
    let amp = max(u.base_bg.a, 0.5);

    let c1 = vec2<f32>(0.22 + 0.15 * sin(t * 0.85), 0.24 + 0.14 * cos(t * 0.72));
    let c2 = vec2<f32>(0.78 + 0.14 * cos(t * 0.62), 0.30 + 0.16 * sin(t * 0.88));
    let c3 = vec2<f32>(0.46 + 0.20 * sin(t * 0.50 + 2.1), 0.78 + 0.13 * cos(t * 0.64));
    let c4 = vec2<f32>(0.16 + 0.12 * cos(t * 0.78 + 1.2), 0.72 + 0.15 * sin(t * 0.56));

    let w1 = orb(uv, c1, vec2<f32>(0.64, 0.70));
    let w2 = orb(uv, c2, vec2<f32>(0.68, 0.66));
    let w3 = orb(uv, c3, vec2<f32>(0.72, 0.64));
    let w4 = orb(uv, c4, vec2<f32>(0.62, 0.68));

    var col = u.base_bg.rgb;
    col = mix(col, u.color_a.rgb, clamp(w1 * 0.48 * amp, 0.0, 0.70));
    col = mix(col, u.color_b.rgb, clamp(w2 * 0.44 * amp, 0.0, 0.64));
    col = mix(col, u.color_c.rgb, clamp(w3 * 0.38 * amp, 0.0, 0.56));
    col = mix(col, (u.color_a.rgb + u.color_b.rgb) * 0.5, clamp(w4 * 0.28 * amp, 0.0, 0.44));

    // Soft vignette for velvety Apple Music depth
    let v_dist = length(uv - vec2<f32>(0.5, 0.48));
    let vignette = 1.0 - smoothstep(0.38, 1.05, v_dist) * 0.16;
    col *= vignette;

    // 8-bit dither to prevent dark gradient banding
    let n = (dither_hash(input.pos.xy) - 0.5) / 255.0;
    col = clamp(col + vec3<f32>(n, n, n), vec3<f32>(0.0), vec3<f32>(1.0));

    return vec4<f32>(col, 1.0);
}
"#;
